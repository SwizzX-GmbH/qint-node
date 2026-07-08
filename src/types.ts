/**
 * Typed models for the Qint public merchant API.
 *
 * These mirror the wire contract exactly (statuses are lowercase, timestamps
 * are ISO-8601 strings, monetary amounts are JSON numbers). See
 * https://docs.qint.ch for the authoritative reference.
 */

/** Fiat currency accepted when creating an intent. */
export type Currency = "CHF" | "EUR" | "USD";

/**
 * Lifecycle status of a payment intent, lowercase on the wire.
 *
 * `initiated` → `pending` → `confirmed` → `settled` is the happy path;
 * `failed`, `expired` and `cancelled` are terminal off-ramps.
 */
export type IntentStatus =
  | "initiated"
  | "pending"
  | "confirmed"
  | "settled"
  | "failed"
  | "expired"
  | "cancelled";

/** All valid {@link IntentStatus} values, handy for validation or UI. */
export const INTENT_STATUSES: readonly IntentStatus[] = [
  "initiated",
  "pending",
  "confirmed",
  "settled",
  "failed",
  "expired",
  "cancelled",
] as const;

/**
 * A payment intent as returned by the API.
 *
 * Send the buyer to {@link Intent.checkoutUrl}; the hosted checkout collects
 * the crypto payment and drives the intent through its lifecycle.
 */
export interface Intent {
  /** Opaque intent id, e.g. `pi_...`. */
  id: string;
  /** Current lifecycle status (lowercase). */
  status: IntentStatus;
  /** Fiat amount as a decimal number. */
  amount: number;
  /** Fiat currency the amount is denominated in. */
  currency: Currency;
  /** Optional human-readable title shown on the checkout. */
  title?: string | null;
  /** Crypto asset the buyer selected to pay with, once chosen (e.g. `BTC`). */
  assetSymbol?: string | null;
  /** Expected crypto amount, formatted to 8 decimal places as a string. */
  cryptoAmount?: string | null;
  /** On-chain deposit address, once an asset has been selected. */
  depositAddress?: string | null;
  /** Hosted checkout URL — redirect the buyer here. */
  checkoutUrl: string;
  /** Optional merchant return URL the checkout links back to. */
  returnUrl?: string | null;
  /** When the intent was created (ISO-8601). */
  createdAt: string;
  /** When the intent expires if unpaid (ISO-8601). */
  expiresAt: string;
  /** When the payment was confirmed on-chain (ISO-8601), if it has been. */
  confirmedAt?: string | null;
  /** When funds were settled to the merchant (ISO-8601), if they have been. */
  settledAt?: string | null;
}

/** Parameters for {@link QintClient.createIntent}. */
export interface CreateIntentParams {
  /** Fiat amount to charge (decimal). */
  amount: number;
  /** Fiat currency. */
  currency: Currency;
  /** Optional title shown on the hosted checkout. */
  title?: string;
  /**
   * Optional idempotency key. Retrying a create with the same key returns the
   * original intent (HTTP 200) instead of creating a duplicate.
   */
  idempotencyKey?: string;
  /**
   * Optional HTTPS return URL (max 500 chars). The checkout renders a
   * "Return to merchant" link and appends `?qint_intent={id}&status={status}`.
   */
  returnUrl?: string;
}

/** Parameters for {@link QintClient.listIntents}. */
export interface ListIntentsParams {
  /** Filter by lifecycle status. */
  status?: IntentStatus;
  /** 1-based page number (default 1). */
  page?: number;
  /** Page size, 1–100 (default 20). */
  pageSize?: number;
}

/** A page of intents as returned by {@link QintClient.listIntents}. */
export interface IntentList {
  /** The intents on this page, newest first. */
  items: Intent[];
  /** Total number of intents matching the query across all pages. */
  total: number;
  /** The page number that was returned. */
  page: number;
  /** The page size that was applied. */
  pageSize: number;
}

/**
 * The webhook payload delivered to a merchant endpoint.
 *
 * Emitted on every payment-intent status transition and on every
 * underpaid-flag flip. Verify the signature with
 * {@link verifyWebhookSignature} before trusting it, and dedupe on the
 * `X-Qint-Event-Id` header.
 */
export interface PaymentStatusEvent {
  /** Always `"payment.status"`. */
  type: "payment.status";
  /** The intent this event concerns. */
  intentId: string;
  /** The intent's status at the moment of the event (lowercase). */
  status: IntentStatus;
  /** Fiat amount (decimal). */
  amount: number;
  /** Fiat currency. */
  currency: Currency;
  /** Crypto asset the buyer paid with, if selected. */
  assetSymbol?: string | null;
  /** Related invoice id, if the intent originated from an invoice. */
  invoiceId?: string | null;
  /** Related payment-link id, if the intent originated from a payment link. */
  paymentLinkId?: string | null;
  /** When the event occurred (ISO-8601). */
  occurredAt: string;
  /** True when the buyer paid less than the expected crypto amount. */
  underpaid?: boolean;
  /** Expected crypto amount (decimal), present on underpayment events. */
  expectedCryptoAmount?: number | null;
  /** Crypto amount actually received (decimal), present on underpayment events. */
  receivedCryptoAmount?: number | null;
}

/** RFC 7807 problem details, as returned by the API on non-2xx responses. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  [key: string]: unknown;
}
