import { describe, it, expect } from "vitest";
import { QintClient, QintApiError, DEFAULT_BASE_URL, CURRENCIES, type FetchLike } from "../src/index.js";
import type { Intent } from "../src/index.js";

/** A recorded request, for asserting request shaping. */
interface Recorded {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Build a mock fetch that records the request and returns a canned response.
 * No network is touched.
 */
function mockFetch(
  response: { ok?: boolean; status?: number; body?: unknown; contentType?: string },
): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    const text = response.body === undefined ? "" : JSON.stringify(response.body);
    return {
      ok,
      status,
      headers: { get: () => response.contentType ?? "application/json" },
      text: async () => text,
    };
  };
  return { fetch, calls };
}

const sampleIntent: Intent = {
  id: "pi_123",
  status: "initiated",
  amount: 49.9,
  currency: "CHF",
  checkoutUrl: "https://checkout.qint.ch/pay/pi_123",
  createdAt: "2026-07-07T10:00:00Z",
  expiresAt: "2026-07-07T10:30:00Z",
};

describe("QintClient.createIntent", () => {
  it("POSTs to /intents with the bearer header and JSON body", async () => {
    const { fetch, calls } = mockFetch({ status: 201, body: sampleIntent });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const intent = await client.createIntent({
      amount: 49.9,
      currency: "CHF",
      title: "Order #42",
      idempotencyKey: "idem-1",
      returnUrl: "https://shop.example/return",
    });

    expect(intent).toEqual(sampleIntent);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${DEFAULT_BASE_URL}/intents`);
    expect(call.headers?.Authorization).toBe("Bearer qk_live_test");
    expect(call.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({
      amount: 49.9,
      currency: "CHF",
      title: "Order #42",
      idempotencyKey: "idem-1",
      returnUrl: "https://shop.example/return",
    });
  });

  it("omits optional fields that were not provided", async () => {
    const { fetch, calls } = mockFetch({ status: 201, body: sampleIntent });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    await client.createIntent({ amount: 10, currency: "EUR", idempotencyKey: "order-10" });

    expect(JSON.parse(calls[0]!.body!)).toEqual({
      amount: 10,
      currency: "EUR",
      idempotencyKey: "order-10",
    });
  });

  it("throws when idempotencyKey is missing", () => {
    const { fetch, calls } = mockFetch({ status: 201, body: sampleIntent });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    expect(() =>
      // @ts-expect-error intentionally missing idempotencyKey
      client.createIntent({ amount: 10, currency: "EUR" }),
    ).toThrow(/idempotencyKey/);
    expect(calls).toHaveLength(0);
  });

  it("honors a custom baseUrl and strips its trailing slash", async () => {
    const { fetch, calls } = mockFetch({ status: 201, body: sampleIntent });
    const client = new QintClient({
      apiKey: "qk_live_test",
      baseUrl: "https://api.example.test/v1/",
      fetch,
    });

    await client.createIntent({ amount: 1, currency: "USD", idempotencyKey: "order-1" });

    expect(calls[0]!.url).toBe("https://api.example.test/v1/intents");
  });
});

describe("QintClient.getIntent", () => {
  it("GETs /intents/{id} with the id URL-encoded", async () => {
    const { fetch, calls } = mockFetch({ status: 200, body: sampleIntent });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const intent = await client.getIntent("pi_ab/cd");

    expect(intent).toEqual(sampleIntent);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${DEFAULT_BASE_URL}/intents/pi_ab%2Fcd`);
    expect(calls[0]!.body).toBeUndefined();
  });
});

describe("QintClient.listIntents", () => {
  it("builds the query string from status/page/pageSize", async () => {
    const page = { items: [sampleIntent], total: 1, page: 2, pageSize: 25 };
    const { fetch, calls } = mockFetch({ status: 200, body: page });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const result = await client.listIntents({ status: "settled", page: 2, pageSize: 25 });

    expect(result).toEqual(page);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${DEFAULT_BASE_URL}/intents?status=settled&page=2&pageSize=25`);
  });

  it("sends no query string when called with no params", async () => {
    const { fetch, calls } = mockFetch({
      status: 200,
      body: { items: [], total: 0, page: 1, pageSize: 20 },
    });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    await client.listIntents();

    expect(calls[0]!.url).toBe(`${DEFAULT_BASE_URL}/intents`);
  });
});

describe("error handling", () => {
  it("throws QintApiError carrying the status and problem detail", async () => {
    const { fetch } = mockFetch({
      status: 403,
      ok: false,
      body: {
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "This API key lacks the Write scope.",
      },
    });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    await expect(
      client.createIntent({ amount: 1, currency: "CHF", idempotencyKey: "order-1" }),
    ).rejects.toMatchObject({
      name: "QintApiError",
      status: 403,
      detail: "This API key lacks the Write scope.",
      title: "Forbidden",
    });

    const err = await client
      .createIntent({ amount: 1, currency: "CHF", idempotencyKey: "order-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(QintApiError);
    expect(err.message).toBe("This API key lacks the Write scope.");
  });

  it("still throws QintApiError when the error body is not JSON", async () => {
    const { fetch } = mockFetch({ status: 500, ok: false, body: undefined });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const err = await client.getIntent("pi_1").catch((e) => e);
    expect(err).toBeInstanceOf(QintApiError);
    expect(err.status).toBe(500);
  });
});

describe("GBP", () => {
  it("is a supported currency", async () => {
    expect(CURRENCIES).toEqual(["CHF", "EUR", "USD", "GBP"]);
    const { fetch, calls } = mockFetch({ status: 201, body: { ...sampleIntent, currency: "GBP" } });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const intent = await client.createIntent({ amount: 25, currency: "GBP", idempotencyKey: "order-gbp" });

    expect(intent.currency).toBe("GBP");
    expect(JSON.parse(calls[0]!.body!).currency).toBe("GBP");
  });
});

describe("intent fee, underpayment and reversal fields", () => {
  it("parses them when present", async () => {
    const body = {
      ...sampleIntent,
      status: "settled",
      amount: 100,
      settledAt: "2026-07-07T10:20:00Z",
      feeAmount: 0.98,
      netAmount: 97.02,
      settledAmount: null,
      receivedAmount: 98,
      underpaidBps: 200,
      creditUsdt: 108.9,
      creditRate: 0.8909,
      reversedAt: "2026-07-08T09:00:00Z",
    };
    const { fetch } = mockFetch({ body });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const intent = await client.getIntent("pi_123");

    expect(intent.feeAmount).toBe(0.98);
    expect(intent.netAmount).toBe(97.02);
    expect(intent.settledAmount).toBeNull();
    expect(intent.receivedAmount).toBe(98);
    expect(intent.underpaidBps).toBe(200);
    expect(intent.creditUsdt).toBe(108.9);
    expect(intent.creditRate).toBe(0.8909);
    expect(intent.reversedAt).toBe("2026-07-08T09:00:00Z");
  });

  it("leaves them undefined when absent", async () => {
    const { fetch } = mockFetch({ body: sampleIntent });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const intent = await client.getIntent("pi_123");

    expect(intent.feeAmount).toBeUndefined();
    expect(intent.netAmount).toBeUndefined();
    expect(intent.receivedAmount).toBeUndefined();
    expect(intent.underpaidBps).toBeUndefined();
    expect(intent.creditUsdt).toBeUndefined();
    expect(intent.creditRate).toBeUndefined();
    expect(intent.reversedAt).toBeUndefined();
    expect(intent.settledAmount).toBeUndefined();
  });
});

describe("payment limit errors", () => {
  it("exposes code and the limit numbers for amount_out_of_range", async () => {
    const { fetch } = mockFetch({
      status: 400,
      contentType: "application/problem+json",
      body: {
        type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
        title: "Amount out of range",
        status: 400,
        detail:
          "Payments must be between CHF 10 and CHF 100'000 (or the equivalent). This amount is CHF 5.00.",
        code: "amount_out_of_range",
        minChf: 10,
        maxChf: 100000,
        amountChf: 5,
      },
    });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const err = await client
      .createIntent({ amount: 5, currency: "CHF", idempotencyKey: "order-5" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(QintApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("amount_out_of_range");
    expect(err.problem?.minChf).toBe(10);
    expect(err.problem?.maxChf).toBe(100000);
    expect(err.problem?.amountChf).toBe(5);
    expect(err.message).toBe(
      "Payments must be between CHF 10 and CHF 100'000 (or the equivalent). This amount is CHF 5.00.",
    );
  });

  it("exposes code for rate_unavailable", async () => {
    const { fetch } = mockFetch({
      status: 503,
      body: {
        title: "Exchange rate unavailable",
        status: 503,
        detail: "Exchange rate unavailable — try again in a minute.",
        code: "rate_unavailable",
      },
    });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const err = await client
      .createIntent({ amount: 50, currency: "GBP", idempotencyKey: "order-50" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(QintApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe("rate_unavailable");
  });

  it("leaves code undefined when the problem has none", async () => {
    const { fetch } = mockFetch({ status: 404, body: { title: "Not Found", status: 404 } });
    const client = new QintClient({ apiKey: "qk_live_test", fetch });

    const err = await client.getIntent("pi_missing").catch((e) => e);
    expect(err.code).toBeUndefined();
  });
});

describe("construction", () => {
  it("requires an apiKey", () => {
    // @ts-expect-error intentionally missing apiKey
    expect(() => new QintClient({})).toThrow(/apiKey/);
  });
});
