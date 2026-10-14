# @qint/node

The official Node.js / TypeScript SDK for the [Qint](https://docs.qint.ch) public merchant API — a thin, fully typed client over the REST API plus helpers for verifying webhooks. Zero runtime dependencies (built on the global `fetch` and `node:crypto`). Ships ESM, CommonJS, and `.d.ts` types.

## Requirements

- Node.js 18 or newer (for the global `fetch`).

## Install

```bash
npm i @qint/node
```

> Not published to npm yet — see [PUBLISH.md](./PUBLISH.md). Until then, install straight from git:
>
> ```bash
> npm i github:SwizzX-GmbH/qint-node
> ```

## Quickstart (30 seconds)

Create an intent, send the buyer to the hosted checkout, then learn the outcome by polling `getIntent` or (better) by receiving a webhook.

```ts
import { QintClient } from "@qint/node";

const qint = new QintClient({ apiKey: process.env.QINT_API_KEY! }); // qk_live_...

// 1. Create a payment intent.
const intent = await qint.createIntent({
  amount: 49.9,
  currency: "CHF",
  title: "Order #1042",
  idempotencyKey: "order-1042", // safe to retry — returns the same intent
  returnUrl: "https://shop.example/thank-you",
});

// 2. Redirect the buyer to the hosted checkout.
console.log("Send the buyer to:", intent.checkoutUrl);

// 3a. Poll for the result...
const latest = await qint.getIntent(intent.id);
console.log(latest.status); // "initiated" | "pending" | "confirmed" | "settled" | ...

// 3b. ...or list recent intents.
const page = await qint.listIntents({ status: "settled", page: 1, pageSize: 20 });
console.log(page.total, page.items.length);
```

The client sends `Authorization: Bearer <apiKey>` (except on the public
currency list, which needs no key). The default base URL is
`https://api.qint.ch/api/v1` — the stable production hostname; override it via the
`baseUrl` option.

## Currencies

Intents can be created in CHF, EUR, USD or GBP — but only while Qint offers the
currency. Qint can switch a currency off (and back on) at any time; creating an
intent in a switched-off currency fails with a `400`. Ask the public currency
list which ones are enabled and hide the rest in your checkout. It is cacheable
for 30 seconds — cache it on your side rather than calling it per checkout.

```ts
const { currencies } = await qint.listCurrencies();
// [{ code: "CHF", enabled: true }, { code: "EUR", enabled: true }, ..., { code: "GBP", enabled: false }]

const enabled = await qint.enabledCurrencies(); // ["CHF", "EUR", "USD"]
```

## Errors

Any non-2xx response throws a `QintApiError` carrying the HTTP status, the
RFC 7807 problem-details `detail` message and, when the API sends one, a
machine-readable `code`. The full parsed body is on `err.problem`.

```ts
import { QintClient, QintApiError } from "@qint/node";

try {
  await qint.createIntent({ amount: 10, currency: "CHF", idempotencyKey: "order-10" });
} catch (err) {
  if (err instanceof QintApiError) {
    console.error(err.status, err.detail); // e.g. 403 "This API key lacks the Write scope."
  } else {
    throw err;
  }
}
```

`err.traceId` carries the request correlation id — include it in support
requests.

A currency Qint has switched off is refused with a `400` that has **no** `code`;
the `detail` names the currencies you can use, e.g. `"GBP is currently disabled
on Qint. currency must be one of: CHF, EUR, USD."`.

Creating an intent needs a **Write**-scoped key; reading and listing need
**Read**. A key missing the scope gets a `403` with an explanatory `detail`.

### Payment limits

Each payment must be between CHF 10 and CHF 100'000 (or the equivalent in EUR,
USD or GBP; a merchant may have an agreed higher cap). Outside that range `createIntent` throws a `400` with
`err.code === "amount_out_of_range"` and the numbers on `err.problem`
(`minChf`, `maxChf`, `amountChf`). If no exchange rate is available to judge a
non-CHF amount, it throws a `503` with `err.code === "rate_unavailable"` — retry
in a minute.

Known codes are available as `ERROR_CODES` (`amountOutOfRange`,
`rateUnavailable`, and `settlementAssetMismatch` — the last is returned by the
dashboard's payout endpoints, not by the merchant API, and is listed for
completeness). Other codes may be added; treat an unknown one like a code-less
error of the same status.

```ts
if (err instanceof QintApiError && err.code === "amount_out_of_range") {
  console.error(err.detail, err.problem?.minChf, err.problem?.maxChf, err.problem?.amountChf);
}
```

## Underpaid payments

A payment that comes up short but within your accepted underpayment still
settles. The `payment.status` webhook then carries `underpaid: true`,
`receivedAmount` (the fiat amount actually paid, in the intent's currency) and
`underpaidBps` (how short, in basis points of the invoice); both are `null`
otherwise. The `Intent` model declares the same fields plus `underpaid`,
`feeAmount` and `netAmount` (null until settled), `settledAmount`,
`creditUsdt`, `creditRate`, `creditAsset`, `reversed` and `reversedAt` — all
optional, so check for `undefined`/`null` before using them. `reversed: true`
(a non-null `reversedAt`) means the payment was reversed after settlement:
treat it as not paid even though its status stays `settled`.

## Settlement asset

Your Qint balance is held in a stablecoin: **USDC** for merchants registered in
the European Union (USDT is not authorised under MiCA), **USDT** for everyone
else. Once a payment is credited, `intent.creditAsset` says which one —
`creditUsdt` is the credited amount *in that asset* (the field name predates
USDC) and `creditRate` is fiat units of `currency` per 1 unit of it. The
`SettlementAsset` type covers `"USDT" | "USDC"`; treat any other value as
possible.

## Webhooks

Configure an endpoint in the Qint dashboard to receive `payment.status` events
(plus the `ping` test event).
Each delivery is signed. **Always verify the signature against the raw request
body** before trusting the payload, and dedupe on the `X-Qint-Event-Id` header
so a retried delivery is handled at most once. Acknowledge with a `2xx` quickly
and do slow work afterwards.

Header reference:

- `X-Qint-Signature: sha256=<hex HMAC-SHA256(rawBody, secret)>`
- `X-Qint-Event-Id: <unique delivery id>` — use this for idempotent processing.

### Express example

```ts
import express from "express";
import {
  verifyWebhookSignature,
  parseEvent,
  isPaymentStatusEvent,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
} from "@qint/node";

const app = express();
const seen = new Set<string>(); // use a durable store in production

// Capture the RAW body — signature verification needs the exact bytes.
app.post("/webhooks/qint", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body as Buffer;
  const signature = req.header(SIGNATURE_HEADER);

  if (!verifyWebhookSignature(raw, signature, process.env.QINT_WEBHOOK_SECRET!)) {
    return res.sendStatus(400); // whsec_...
  }

  // Dedupe retried deliveries.
  const eventId = req.header(EVENT_ID_HEADER)!;
  if (seen.has(eventId)) return res.sendStatus(200);
  seen.add(eventId);

  const event = parseEvent(raw);
  if (isPaymentStatusEvent(event) && event.status === "settled" && !event.reversed) {
    // fulfil the order for event.intentId
  }
  // `ping` (the dashboard's "Send test event") and any event type this SDK
  // does not know yet: acknowledge and ignore.

  res.sendStatus(200); // ack fast
});
```

`verifyWebhookSignature` does a **constant-time** comparison, so it does not
leak the signature via timing.

## API

```ts
new QintClient(options: {
  apiKey: string;          // qk_live_...
  baseUrl?: string;        // default https://api.qint.ch/api/v1
  timeout?: number;        // ms, default 30000
  fetch?: FetchLike;       // inject a custom fetch (tests, proxies)
});

qint.createIntent(params: {
  amount: number;
  currency: "CHF" | "EUR" | "USD" | "GBP";
  idempotencyKey: string;  // required, unique per merchant (e.g. your order id)
  title?: string;
  returnUrl?: string;      // https, <= 500 chars
}): Promise<Intent>;

qint.getIntent(id: string): Promise<Intent>;

qint.listIntents(params?: {
  status?: IntentStatus;   // initiated | pending | confirmed | settled | failed | expired | cancelled
  page?: number;           // default 1
  pageSize?: number;       // 1..100, default 20
}): Promise<{ items: Intent[]; total: number; page: number; pageSize: number }>;

qint.listCurrencies(): Promise<{ currencies: { code: string; enabled: boolean }[] }>;
qint.enabledCurrencies(): Promise<string[]>;
```

Webhook helpers:

```ts
verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string): boolean;
parseEvent(rawBody: string | Buffer): QintEvent; // PaymentStatusEvent | PingEvent | UnknownEvent
isPaymentStatusEvent(event): event is PaymentStatusEvent;
isPingEvent(event): event is PingEvent;
```

## Development

```bash
npm install
npm test        # vitest, runs fully offline
npm run build   # tsup -> dist/ (ESM + CJS + d.ts)
npm run typecheck
```

## License

MIT © SwizzX GmbH. See [LICENSE](./LICENSE).
