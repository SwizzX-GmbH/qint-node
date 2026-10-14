import type { ProblemDetails, QintErrorCode } from "./types.js";

/**
 * Thrown when the Qint API returns a non-2xx response.
 *
 * Carries the HTTP {@link QintApiError.status} and, when the body is RFC 7807
 * `application/problem+json`, the parsed {@link QintApiError.problem} and its
 * `detail` message (surfaced as the error `message`). Branch on
 * {@link QintApiError.code} for machine-readable errors such as
 * `amount_out_of_range` (400) or `rate_unavailable` (503).
 *
 * Some 400s carry no `code` — e.g. a currency Qint has switched off
 * (`detail`: "GBP is currently disabled on Qint. currency must be one of:
 * CHF, EUR, USD."). Check {@link QintClient.listCurrencies} up front instead.
 */
export class QintApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** The `detail` field from the problem-details body, if present. */
  readonly detail?: string;
  /** The `type` URI from the problem-details body, if present. */
  readonly type?: string;
  /** The `title` from the problem-details body, if present. */
  readonly title?: string;
  /** The `traceId` from the problem body, if present — quote it to support. */
  readonly traceId?: string;
  /**
   * Machine-readable error code from the problem body (`code`), if present —
   * e.g. `amount_out_of_range` or `rate_unavailable`.
   */
  readonly code?: QintErrorCode;
  /**
   * The full parsed problem-details body, if the response was JSON. Extra
   * members such as `minChf`, `maxChf` and `amountChf` are available here.
   */
  readonly problem?: ProblemDetails;

  constructor(status: number, problem?: ProblemDetails, fallbackMessage?: string) {
    const message =
      problem?.detail ||
      problem?.title ||
      fallbackMessage ||
      `Qint API request failed with status ${status}`;
    super(message);
    this.name = "QintApiError";
    this.status = status;
    this.detail = problem?.detail;
    this.type = problem?.type;
    this.title = problem?.title;
    this.traceId = typeof problem?.traceId === "string" ? problem.traceId : undefined;
    this.code = typeof problem?.code === "string" ? problem.code : undefined;
    this.problem = problem;
    // Restore the prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, QintApiError.prototype);
  }
}
