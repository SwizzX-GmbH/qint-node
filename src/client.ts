import { QintApiError } from "./errors.js";
import type {
  CreateIntentParams,
  CurrencyList,
  Intent,
  IntentList,
  ListIntentsParams,
  ProblemDetails,
} from "./types.js";

/** The default Qint public API base URL (the stable production hostname). */
export const DEFAULT_BASE_URL = "https://api.qint.ch/api/v1";

/**
 * Minimal `fetch` shape the client depends on. Node 18+ and modern browsers
 * provide a compatible global; a custom implementation can be injected for
 * testing or bespoke transports.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Options for constructing a {@link QintClient}. */
export interface QintClientOptions {
  /** Your Qint secret API key, e.g. `qk_live_...`. Required. */
  apiKey: string;
  /**
   * API base URL. Defaults to {@link DEFAULT_BASE_URL}. A trailing slash is
   * tolerated.
   */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /**
   * Custom `fetch` implementation. Defaults to the global `fetch`. Injecting
   * one lets you mock the transport in tests or route through a proxy.
   */
  fetch?: FetchLike;
}

/**
 * A thin, typed client over the Qint public merchant API.
 *
 * @example
 * ```ts
 * const qint = new QintClient({ apiKey: process.env.QINT_API_KEY! });
 * const intent = await qint.createIntent({
 *   amount: 49.9,
 *   currency: "CHF",
 *   idempotencyKey: "order-1001",
 * });
 * // redirect the buyer to intent.checkoutUrl
 * ```
 */
export class QintClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: QintClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error("QintClient requires an `apiKey`.");
    }
    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error(
        "No `fetch` implementation available. Use Node 18+ or pass `fetch` in the client options.",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? 30_000;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Create a payment intent. Send the buyer to the returned
   * {@link Intent.checkoutUrl}.
   *
   * `idempotencyKey` is required and must be unique per merchant. Passing the
   * same key again returns the original intent instead of creating a
   * duplicate.
   */
  createIntent(params: CreateIntentParams): Promise<Intent> {
    if (!params.idempotencyKey) {
      throw new Error("createIntent requires an `idempotencyKey`.");
    }
    const body: Record<string, unknown> = {
      amount: params.amount,
      currency: params.currency,
      idempotencyKey: params.idempotencyKey,
    };
    if (params.title !== undefined) body.title = params.title;
    if (params.returnUrl !== undefined) body.returnUrl = params.returnUrl;
    return this.request<Intent>("POST", "/intents", { body });
  }

  /** Retrieve a single intent by id. */
  getIntent(id: string): Promise<Intent> {
    if (!id) throw new Error("getIntent requires an intent id.");
    return this.request<Intent>("GET", `/intents/${encodeURIComponent(id)}`);
  }

  /** List intents, newest first, optionally filtered by status and paged. */
  listIntents(params: ListIntentsParams = {}): Promise<IntentList> {
    const query: Record<string, string> = {};
    if (params.status !== undefined) query.status = params.status;
    if (params.page !== undefined) query.page = String(params.page);
    if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
    return this.request<IntentList>("GET", "/intents", { query });
  }

  /**
   * List every fiat currency Qint knows, in display order, with whether it is
   * offered for **new** payments right now (`GET /public/currencies`).
   *
   * Qint can switch a currency off (and back on) at any time; while it is off,
   * {@link QintClient.createIntent} in that currency fails with a `400`. Use
   * this to hide disabled currencies in your checkout. The endpoint is public
   * (no API key is sent) and cacheable for 30 seconds — cache it on your side
   * rather than calling it on every checkout.
   */
  listCurrencies(): Promise<CurrencyList> {
    return this.request<CurrencyList>("GET", "/public/currencies", { auth: false });
  }

  /**
   * Convenience over {@link QintClient.listCurrencies}: the codes currently
   * enabled for new payments, in display order (e.g. `["CHF", "EUR"]`).
   */
  async enabledCurrencies(): Promise<string[]> {
    const list = await this.listCurrencies();
    return (list?.currencies ?? []).filter((c) => c.enabled).map((c) => c.code);
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; auth?: boolean } = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (opts.query && Object.keys(opts.query).length > 0) {
      url += `?${new URLSearchParams(opts.query).toString()}`;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.auth !== false) headers.Authorization = `Bearer ${this.apiKey}`;
    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new QintApiError(0, undefined, `Request to ${url} timed out after ${this.timeout}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new QintApiError(response.status, parseProblem(raw), `HTTP ${response.status}`);
    }
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}

function parseProblem(raw: string): ProblemDetails | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as ProblemDetails) : undefined;
  } catch {
    return undefined;
  }
}
