/**
 * ForgePay HTTP client.
 *
 * - Uses the native `fetch` API (Node 18+, all browsers)
 * - Automatic retries with exponential backoff on 429 / 5xx
 * - Idempotency key injection
 * - Full TypeScript types
 */

import {
  ApiError,
  AuthenticationError,
  ForgePayError,
  IdempotencyError,
  InvalidRequestError,
  RateLimitError,
} from './errors.js';

export interface FPClientOptions {
  /** Your secret API key. Keep this on the server — never in browser code. */
  apiKey: string;
  /** API base URL. Defaults to https://api.forgepay.io */
  baseUrl?: string;
  /** API version header. Defaults to '2026-04'. */
  apiVersion?: string;
  /** Maximum retries on transient errors. Defaults to 3. */
  maxRetries?: number;
  /** Request timeout in ms. Defaults to 30000. */
  timeout?: number;
}

interface RequestOptions {
  idempotencyKey?: string;
  extraHeaders?:   Record<string, string>;
}

const DEFAULT_BASE_URL  = 'https://api.forgepay.io';
const DEFAULT_VERSION   = '2026-04';
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS    = [500, 1500, 5000];

export class FPHttpClient {
  private readonly apiKey:      string;
  private readonly baseUrl:     string;
  private readonly apiVersion:  string;
  private readonly maxRetries:  number;
  private readonly timeout:     number;

  constructor(opts: FPClientOptions) {
    if (!opts.apiKey) throw new Error('ForgePay: apiKey is required');
    this.apiKey     = opts.apiKey;
    this.baseUrl    = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiVersion = opts.apiVersion ?? DEFAULT_VERSION;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeout    = opts.timeout ?? 30_000;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>, options?: RequestOptions): Promise<T> {
    const url = this._buildUrl(path, params);
    return this._request<T>('GET', url, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const url = this._buildUrl(path);
    return this._request<T>('POST', url, body, options);
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const url = this._buildUrl(path);
    return this._request<T>('PATCH', url, body, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    const url = this._buildUrl(path);
    return this._request<T>('DELETE', url, undefined, options);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async _request<T>(
    method:   string,
    url:      string,
    body?:    unknown,
    options?: RequestOptions,
  ): Promise<T> {
    let lastError: ForgePayError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 5000;
        await sleep(delay);
      }

      const headers: Record<string, string> = {
        'Authorization':        `Bearer ${this.apiKey}`,
        'ForgePay-Version':     this.apiVersion,
        'User-Agent':           `ForgePay-SDK-JS/0.1.0 (node/${typeof process !== 'undefined' ? process.version : 'browser'})`,
        'Content-Type':         'application/json',
        'Accept':               'application/json',
        ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...(options?.extraHeaders ?? {}),
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body:   body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (err) {
        lastError = new ApiError(`Network error: ${String(err)}`, 0);
        if (attempt < this.maxRetries) continue;
        throw lastError;
      }

      const requestId = res.headers.get('x-request-id') ?? undefined;

      // Success
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return res.json() as Promise<T>;
      }

      // Parse error body
      let errBody: { error?: { code?: string; message?: string; param?: string } } = {};
      try { errBody = await res.json(); } catch { /* ignore */ }
      const errMsg   = errBody.error?.message ?? res.statusText;
      const errCode  = errBody.error?.code    ?? 'unknown';
      const errParam = errBody.error?.param;

      // Map to typed errors
      if (res.status === 401) throw new AuthenticationError(errMsg, requestId);
      if (res.status === 400) throw new InvalidRequestError(errMsg, errParam, requestId);
      if (res.status === 422) throw new IdempotencyError(errMsg, requestId);

      if (res.status === 429) {
        lastError = new RateLimitError(errMsg, requestId);
        if (attempt < this.maxRetries) {
          const retryAfter = res.headers.get('retry-after');
          if (retryAfter) await sleep(parseInt(retryAfter, 10) * 1000);
          continue;
        }
        throw lastError;
      }

      if (RETRY_STATUS_CODES.has(res.status)) {
        lastError = new ApiError(errMsg, res.status, requestId);
        if (attempt < this.maxRetries) continue;
        throw lastError;
      }

      throw new ApiError(errMsg, res.status, requestId);
    }

    throw lastError ?? new ApiError('Unknown error', 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
