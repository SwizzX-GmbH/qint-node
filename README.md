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

The client sends `Authorization: Bearer <apiKey>`. The default base URL is
`https://api.qint.ch/api/v1` — the stable production hostname; override it via the
`baseUrl` option.

## Errors

Any non-2xx response throws a `QintApiError` carrying the HTTP status and the
RFC 7807 problem-details `detail` message.

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

Creating an intent needs a **Write**-scoped key; reading and listing need
**Read**. A key missing the scope gets a `403` with an explanatory `detail`.

## Webhooks

Configure an endpoint in the Qint dashboard to receive `payment.status` events.
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
import { verifyWebhookSignature, parseEvent, SIGNATURE_HEADER, EVENT_ID_HEADER } from "@qint/node";

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
  if (event.type === "payment.status" && event.status === "settled") {
    // fulfil the order for event.intentId
  }

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
  currency: "CHF" | "EUR" | "USD";
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
```

Webhook helpers:

```ts
verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string): boolean;
parseEvent(rawBody: string | Buffer): PaymentStatusEvent;
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
