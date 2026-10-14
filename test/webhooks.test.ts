import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  parseEvent,
  isPaymentStatusEvent,
  isPingEvent,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
  type PaymentStatusEvent,
} from "../src/index.js";

const secret = "whsec_test_secret";

/** Sign a body exactly as the Qint delivery worker does. */
function sign(body: string, key = secret): string {
  return "sha256=" + createHmac("sha256", key).update(body).digest("hex");
}

const eventBody = JSON.stringify({
  type: "payment.status",
  intentId: "pi_123",
  status: "confirmed",
  amount: 49.9,
  currency: "CHF",
  assetSymbol: "BTC",
  underpaid: false,
  occurredAt: "2026-07-07T10:05:00Z",
});

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(eventBody, sign(eventBody), secret)).toBe(true);
  });

  it("accepts a Buffer body", () => {
    const buf = Buffer.from(eventBody, "utf8");
    expect(verifyWebhookSignature(buf, sign(eventBody), secret)).toBe(true);
  });

  it("accepts a bare hex digest without the sha256= prefix", () => {
    const bare = sign(eventBody).slice("sha256=".length);
    expect(verifyWebhookSignature(eventBody, bare, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = eventBody.replace("49.9", "4999");
    expect(verifyWebhookSignature(tampered, sign(eventBody), secret)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const good = sign(eventBody);
    const bad = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    expect(verifyWebhookSignature(eventBody, bad, secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhookSignature(eventBody, sign(eventBody, "whsec_wrong"), secret)).toBe(false);
  });

  it("rejects a missing or empty signature header", () => {
    expect(verifyWebhookSignature(eventBody, "", secret)).toBe(false);
    expect(verifyWebhookSignature(eventBody, null, secret)).toBe(false);
    expect(verifyWebhookSignature(eventBody, undefined, secret)).toBe(false);
  });

  it("rejects when the secret is empty", () => {
    expect(verifyWebhookSignature(eventBody, sign(eventBody), "")).toBe(false);
  });
});

describe("parseEvent", () => {
  it("parses a raw string body into a typed event", () => {
    const event: PaymentStatusEvent = parseEvent(eventBody);
    expect(event.type).toBe("payment.status");
    expect(event.intentId).toBe("pi_123");
    expect(event.status).toBe("confirmed");
    expect(event.amount).toBe(49.9);
    expect(event.currency).toBe("CHF");
    expect(event.assetSymbol).toBe("BTC");
    expect(event.underpaid).toBe(false);
  });

  it("parses the accepted-underpayment and reversal fields", () => {
    const body = JSON.stringify({
      type: "payment.status",
      intentId: "pi_456",
      status: "settled",
      amount: 100,
      currency: "GBP",
      assetSymbol: "USDT",
      underpaid: true,
      receivedAmount: 98,
      underpaidBps: 200,
      expectedCryptoAmount: "126.58227848",
      receivedCryptoAmount: "124.05063291",
      invoiceId: null,
      paymentLinkId: null,
      reversed: false,
      reversedAt: null,
      occurredAt: "2026-07-07T10:05:00Z",
    });
    const event = parseEvent<PaymentStatusEvent>(body);
    expect(event.currency).toBe("GBP");
    expect(event.underpaid).toBe(true);
    expect(event.receivedAmount).toBe(98);
    expect(event.underpaidBps).toBe(200);
    expect(event.expectedCryptoAmount).toBe("126.58227848");
    expect(event.receivedCryptoAmount).toBe("124.05063291");
    expect(event.reversed).toBe(false);
    expect(event.reversedAt).toBeNull();
  });

  it("tolerates events without the underpayment fields", () => {
    const event = parseEvent<PaymentStatusEvent>(eventBody);
    expect(event.receivedAmount).toBeUndefined();
    expect(event.underpaidBps).toBeUndefined();
    expect(event.reversedAt).toBeUndefined();
  });

  it("parses a Buffer body", () => {
    const event = parseEvent(Buffer.from(eventBody, "utf8"));
    expect(isPaymentStatusEvent(event)).toBe(true);
    if (isPaymentStatusEvent(event)) expect(event.intentId).toBe("pi_123");
  });

  it("parses the ping test event", () => {
    const event = parseEvent(
      JSON.stringify({ type: "ping", endpointId: "6f1c0b8e-0000-4000-8000-000000000001", sentAt: "2026-10-14T10:00:00Z" }),
    );
    expect(isPingEvent(event)).toBe(true);
    expect(isPaymentStatusEvent(event)).toBe(false);
    if (isPingEvent(event)) {
      expect(event.endpointId).toBe("6f1c0b8e-0000-4000-8000-000000000001");
      expect(event.sentAt).toBe("2026-10-14T10:00:00Z");
    }
  });

  it("tolerates unknown event types and unknown fields", () => {
    const event = parseEvent(JSON.stringify({ type: "payout.paid", payoutId: "po_1", brandNew: { x: 1 } }));
    expect(event.type).toBe("payout.paid");
    expect(isPaymentStatusEvent(event)).toBe(false);
    expect(isPingEvent(event)).toBe(false);
    expect((event as Record<string, unknown>).payoutId).toBe("po_1");
  });
});

describe("header constants", () => {
  it("exposes the documented header names", () => {
    expect(SIGNATURE_HEADER).toBe("X-Qint-Signature");
    expect(EVENT_ID_HEADER).toBe("X-Qint-Event-Id");
  });
});
