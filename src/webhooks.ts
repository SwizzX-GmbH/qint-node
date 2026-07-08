import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentStatusEvent } from "./types.js";

/** Header carrying the HMAC signature: `X-Qint-Signature: sha256=<hex>`. */
export const SIGNATURE_HEADER = "X-Qint-Signature";
/** Header carrying the unique delivery id — dedupe on this value. */
export const EVENT_ID_HEADER = "X-Qint-Event-Id";

/**
 * Verify a Qint webhook signature using a constant-time comparison.
 *
 * Computes `sha256=<hex HMAC-SHA256(rawBody, secret)>` and compares it against
 * the value of the `X-Qint-Signature` header. The comparison is constant-time
 * to avoid leaking the signature via timing.
 *
 * IMPORTANT: pass the EXACT raw request body bytes — verifying a re-serialized
 * object will fail because a single byte of difference changes the HMAC.
 *
 * @param rawBody The raw request body, as received (string or Buffer).
 * @param signatureHeader The `X-Qint-Signature` header value, e.g.
 *   `sha256=abc123...`. A bare hex digest (no `sha256=` prefix) is also accepted.
 * @param secret Your endpoint signing secret, e.g. `whsec_...`.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Compare as bytes; timingSafeEqual requires equal-length buffers, so a
  // length mismatch is an early, still-safe reject.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse a raw webhook body into a typed {@link PaymentStatusEvent}.
 *
 * Verify the signature with {@link verifyWebhookSignature} BEFORE trusting the
 * parsed event, and dedupe on the `X-Qint-Event-Id` header so a retried
 * delivery is processed at most once.
 */
export function parseEvent(rawBody: string | Buffer): PaymentStatusEvent {
  const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return JSON.parse(text) as PaymentStatusEvent;
}
