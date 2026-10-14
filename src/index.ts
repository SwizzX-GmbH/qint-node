/**
 * @qint/node — the official Node.js / TypeScript SDK for the Qint public
 * merchant API. A thin, typed client plus webhook helpers.
 *
 * @see https://docs.qint.ch
 */

export { QintClient, DEFAULT_BASE_URL } from "./client.js";
export type { QintClientOptions, FetchLike } from "./client.js";
export { QintApiError } from "./errors.js";
export {
  verifyWebhookSignature,
  parseEvent,
  isPaymentStatusEvent,
  isPingEvent,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
} from "./webhooks.js";
export {
  INTENT_STATUSES,
  CURRENCIES,
  SETTLEMENT_ASSETS,
  ERROR_CODES,
  type Currency,
  type SettlementAsset,
  type CurrencyAvailability,
  type CurrencyList,
  type PingEvent,
  type UnknownEvent,
  type QintEvent,
  type QintErrorCode,
  type IntentStatus,
  type Intent,
  type CreateIntentParams,
  type ListIntentsParams,
  type IntentList,
  type PaymentStatusEvent,
  type ProblemDetails,
} from "./types.js";
