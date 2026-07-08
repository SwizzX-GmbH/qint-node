import type { ProblemDetails } from "./types.js";

/**
 * Thrown when the Qint API returns a non-2xx response.
 *
 * Carries the HTTP {@link QintApiError.status} and, when the body is RFC 7807
 * `application/problem+json`, the parsed {@link QintApiError.problem} and its
 * `detail` message (surfaced as the error `message`).
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
  /** The full parsed problem-details body, if the response was JSON. */
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
    this.problem = problem;
    // Restore the prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, QintApiError.prototype);
  }
}
