import { describe, it, expect } from "vitest";
import { QintClient, QintApiError, DEFAULT_BASE_URL, type FetchLike } from "../src/index.js";
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

    await client.createIntent({ amount: 10, currency: "EUR" });

    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: 10, currency: "EUR" });
  });

  it("honors a custom baseUrl and strips its trailing slash", async () => {
    const { fetch, calls } = mockFetch({ status: 201, body: sampleIntent });
    const client = new QintClient({
      apiKey: "qk_live_test",
      baseUrl: "https://api.qint.ch/api/v1/",
      fetch,
    });

    await client.createIntent({ amount: 1, currency: "USD" });

    expect(calls[0]!.url).toBe("https://api.qint.ch/api/v1/intents");
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

    await expect(client.createIntent({ amount: 1, currency: "CHF" })).rejects.toMatchObject({
      name: "QintApiError",
      status: 403,
      detail: "This API key lacks the Write scope.",
      title: "Forbidden",
    });

    const err = await client.createIntent({ amount: 1, currency: "CHF" }).catch((e) => e);
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

describe("construction", () => {
  it("requires an apiKey", () => {
    // @ts-expect-error intentionally missing apiKey
    expect(() => new QintClient({})).toThrow(/apiKey/);
  });
});
