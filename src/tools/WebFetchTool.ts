/**
 * WebFetchTool — Fetches public web URLs and returns cleaned, readable text.
 *
 * Ported from the C# `WebFetchToolProvider`.
 *
 * Features:
 * - SSRF protection via {@link validatePublicUrl} — every redirect target is
 *   re-validated before following (defends against DNS rebinding).
 * - Manual redirect following with per-hop URL validation (default max 5).
 * - Response body size limiting (default 2 MB).
 * - Rate limiting — minimum delay between consecutive requests (default 1 s).
 * - Automatic retry on HTTP 403 / 429 by first fetching the site homepage to
 *   collect cookies, then re-issuing the original request.
 * - Readable text extraction via {@link extractReadableText} (HTML cleaning,
 *   entity decoding, whitespace normalisation, truncation).
 *
 * Requires Node.js 18+ (uses the built-in `fetch` API, `AbortController`,
 * and web `ReadableStream`).
 *
 * @module WebFetchTool
 */

import { validatePublicUrl, isRedirect } from "./SsrfGuard.js";
import {
  extractReadableText,
  type ReadableTextResult,
} from "./HtmlCleaner.js";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Options for constructing a {@link WebFetchTool}.
 *
 * All fields are optional; unspecified fields use documented defaults.
 */
export interface WebFetchToolOptions {
  /** Maximum response body size in bytes. Default: 2 MB (2_097_152). */
  maxResponseBytes?: number;
  /** Per-request timeout in milliseconds. Default: 15_000. */
  timeoutMs?: number;
  /** Maximum number of redirect hops to follow. Default: 5. */
  maxRedirects?: number;
  /** Minimum delay between consecutive requests in milliseconds. Default: 1_000. */
  minDelayMs?: number;
  /** Default character limit for extracted text when `maxChars` is omitted. Default: 20_000. */
  defaultMaxChars?: number;
  /** Hard upper bound on extracted text characters. Default: 50_000. */
  hardMaxChars?: number;
}

/**
 * Result of a {@link WebFetchTool.fetch} call.
 *
 * The `ok` field is a discriminating flag: when `true`, the fetch completed
 * at the transport level and `statusCode` / `text` / `title` are populated;
 * when `false`, `error` contains a human-readable failure reason.
 */
export interface WebFetchResult {
  /** Whether the fetch completed without transport-level errors. */
  ok: boolean;
  /** The originally requested URL. */
  url: string;
  /** The final URL after following redirects. */
  finalUrl?: string;
  /** HTTP status code of the final response. */
  statusCode?: number;
  /** HTTP `Content-Type` header of the final response. */
  contentType?: string;
  /** Page title extracted from HTML, when available. */
  title?: string;
  /** Extracted readable text (possibly truncated). */
  text?: string;
  /** Whether the text or response body was truncated. */
  truncated?: boolean;
  /** Total elapsed time in milliseconds. */
  durationMs: number;
  /** Error message when `ok` is `false`. */
  error?: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal representation of a fetched HTTP response.
 *
 * Populated by {@link WebFetchTool.fetchWithRedirects} after the response
 * body has been read (with byte limiting applied).
 */
interface InternalFetchResponse {
  /** The final URL after all redirects. */
  finalUrl: string;
  /** HTTP status code of the final (non-redirect) response. */
  statusCode: number;
  /** HTTP `Content-Type` header value (may be empty). */
  contentType: string;
  /** Raw response body bytes (decompressed, up to `maxResponseBytes`). */
  bytes: Buffer;
  /** Whether the body was truncated at the byte limit. */
  bytesLimited: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** User-Agent string sent with every request. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WordAI/1.0";

/** Accept header sent with every request. */
const ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";

/** Accept-Language header sent with every request. */
const ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8";

/** Delay (ms) after fetching the homepage for cookies before retrying on 403/429. */
const RETRY_DELAY_MS = 2000;

// ============================================================================
// Module-level Rate Limiting
// ============================================================================

/**
 * Timestamp (ms since epoch) of the last *reserved* request time slot.
 *
 * Updated synchronously before any `await` so that concurrent callers in
 * single-threaded JavaScript are naturally serialized without a mutex:
 * each caller reserves its slot (lastRequestTime + minDelayMs) before
 * sleeping, ensuring no two requests fire closer than `minDelayMs` apart.
 */
let lastRequestTime = 0;

/**
 * Enforce a minimum delay between consecutive requests.
 *
 * Reserves a time slot synchronously (updating {@link lastRequestTime})
 * before awaiting the sleep, so concurrent callers are serialized.
 *
 * @param minDelayMs - Minimum milliseconds between requests.
 */
async function waitForRateLimit(minDelayMs: number): Promise<void> {
  const now = Date.now();
  const earliest = lastRequestTime + minDelayMs;
  const targetTime = Math.max(now, earliest);
  const wait = targetTime - now;
  lastRequestTime = targetTime;
  if (wait > 0) {
    await sleep(wait);
  }
}

/**
 * Resolve a promise after `ms` milliseconds.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// CookieJar — minimal cookie store for a single fetch operation
// ============================================================================

/**
 * A minimal cookie jar scoped to a single {@link WebFetchTool.fetch} call.
 *
 * Captures `Set-Cookie` response headers and replays them as `Cookie`
 * request headers. Only the `name=value` pair is retained; attributes
 * (`Path`, `Domain`, `Expires`, `Secure`, etc.) are ignored — this is
 * sufficient for the 403/429 homepage-cookie-retry flow.
 *
 * Cookies are shared across the entire redirect chain and the retry
 * attempt, mirroring the C# `CookieContainer` behaviour.
 */
class CookieJar {
  /** Map of cookie name → value. */
  private readonly cookies = new Map<string, string>();

  /**
   * Capture cookies from a fetch `Response`'s `Set-Cookie` headers.
   *
   * Uses the non-standard `getSetCookie()` method available on undici's
   * `Headers` (Node.js 18+) which correctly returns each `Set-Cookie`
   * header as a separate array entry. Falls back to `headers.get()`
   * when `getSetCookie()` is unavailable.
   *
   * @param response - The fetch `Response` to extract cookies from.
   */
  capture(response: Response): void {
    const setCookies = getSetCookieHeaders(response);
    for (const raw of setCookies) {
      // Extract only the name=value portion (before the first ';').
      const semi = raw.indexOf(";");
      const kv = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
      if (!kv) continue;
      const eq = kv.indexOf("=");
      if (eq > 0) {
        const name = kv.slice(0, eq).trim();
        const value = kv.slice(eq + 1).trim();
        if (name) {
          this.cookies.set(name, value);
        }
      }
    }
  }

  /**
   * Build a `Cookie` header value from stored cookies.
   *
   * @returns The header value (e.g. `"a=1; b=2"`), or an empty string
   *   when no cookies are stored.
   */
  toHeader(): string {
    if (this.cookies.size === 0) return "";
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

/**
 * Extract `Set-Cookie` header values from a fetch `Response`.
 *
 * Prefers the non-standard `getSetCookie()` method (undici / Node.js 18+)
 * which returns each `Set-Cookie` header as a separate string, correctly
 * handling multiple cookies and commas within attribute values. Falls back
 * to `headers.get("set-cookie")` for environments without `getSetCookie()`.
 *
 * @param response - The fetch `Response`.
 * @returns Array of raw `Set-Cookie` header strings (may be empty).
 */
function getSetCookieHeaders(response: Response): string[] {
  // undici's Headers exposes getSetCookie() — not in the TS DOM lib types,
  // so we cast to access it.
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (cookies && cookies.length > 0) return cookies;
  }
  // Fallback: headers.get() combines multiple Set-Cookie values with ", "
  // which is technically incorrect for parsing, but better than nothing.
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

// ============================================================================
// WebFetchTool
// ============================================================================

/**
 * Fetches public HTTP/HTTPS URLs and returns cleaned, readable text.
 *
 * Only public web URLs on ports 80/443 are allowed; localhost and private
 * network addresses are blocked by {@link validatePublicUrl}.
 *
 * @example
 * ```typescript
 * const tool = new WebFetchTool();
 * const result = await tool.fetch("https://example.com");
 * if (result.ok) {
 *   console.log(result.title);
 *   console.log(result.text);
 * }
 * ```
 */
export class WebFetchTool {
  /** Maximum response body size in bytes. */
  private readonly maxResponseBytes: number;
  /** Per-request timeout in milliseconds. */
  private readonly timeoutMs: number;
  /** Maximum number of redirect hops. */
  private readonly maxRedirects: number;
  /** Minimum delay between requests in milliseconds. */
  private readonly minDelayMs: number;
  /** Default character limit for extracted text. */
  private readonly defaultMaxChars: number;
  /** Hard upper bound on extracted text characters. */
  private readonly hardMaxChars: number;

  /**
   * Create a new {@link WebFetchTool}.
   *
   * @param options - Optional configuration. Unspecified fields use defaults:
   *   - `maxResponseBytes`: 2 MB (2_097_152)
   *   - `timeoutMs`: 15_000
   *   - `maxRedirects`: 5
   *   - `minDelayMs`: 1_000
   *   - `defaultMaxChars`: 20_000
   *   - `hardMaxChars`: 50_000
   */
  constructor(options?: WebFetchToolOptions) {
    this.maxResponseBytes = options?.maxResponseBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = options?.timeoutMs ?? 15_000;
    this.maxRedirects = options?.maxRedirects ?? 5;
    this.minDelayMs = options?.minDelayMs ?? 1_000;
    this.defaultMaxChars = options?.defaultMaxChars ?? 20_000;
    this.hardMaxChars = options?.hardMaxChars ?? 50_000;
  }

  /**
   * Fetch a public HTTP/HTTPS URL and return cleaned text content.
   *
   * Execution flow:
   * 1. Validate the URL with {@link validatePublicUrl} (SSRF check).
   * 2. Resolve the character limit (default 20 000, hard cap 50 000).
   * 3. Fetch the URL, manually following redirects (up to `maxRedirects`),
   *    validating every redirect target with {@link validatePublicUrl}.
   * 4. If the response is HTTP 403 or 429, fetch the site homepage to
   *    collect cookies, wait 2 seconds, then retry the original URL.
   * 5. Extract readable text with {@link extractReadableText}.
   * 6. Return a structured {@link WebFetchResult}.
   *
   * On any error (invalid URL, timeout, too many redirects, network
   * failure), the method resolves with `{ ok: false, error: "..." }`
   * rather than throwing.
   *
   * @param url - The public HTTP/HTTPS URL to fetch.
   * @param maxChars - Optional maximum number of text characters to return.
   *   Defaults to 20 000; clamped to a maximum of 50 000.
   * @returns A {@link WebFetchResult}.
   */
  async fetch(url: string, maxChars?: number): Promise<WebFetchResult> {
    const startTime = Date.now();
    try {
      // 1. Validate URL — must be public http/https on port 80/443.
      await validatePublicUrl(url);

      // 2. Resolve the character output limit.
      const outputLimit = this.resolveMaxChars(maxChars);

      // 3. First fetch attempt (with manual redirect following).
      //    A single CookieJar is shared across the redirect chain and the
      //    potential retry, mirroring the C# CookieContainer behaviour.
      const cookieJar = new CookieJar();
      let response = await this.fetchWithRedirects(url, cookieJar);

      // 4. Retry on 403/429 after fetching the homepage for cookies.
      if (response.statusCode === 403 || response.statusCode === 429) {
        await this.fetchHomepageForCookies(response.finalUrl, cookieJar);
        await sleep(RETRY_DELAY_MS);
        response = await this.fetchWithRedirects(url, cookieJar);
      }

      // 5. Extract readable text from the response body.
      const readable: ReadableTextResult = extractReadableText(
        response.contentType,
        response.bytes,
        outputLimit,
      );

      // 6. Build success result.
      return {
        ok: true,
        url,
        finalUrl: response.finalUrl,
        statusCode: response.statusCode,
        contentType: response.contentType,
        title: readable.title,
        text: readable.text,
        truncated: readable.truncated || response.bytesLimited,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        ok: false,
        url: url ?? "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Resolve the character output limit.
   *
   * - `undefined`, `null` or `<= 0` → use {@link defaultMaxChars}.
   * - Otherwise → `min(value, hardMaxChars)`.
   *
   * @param maxChars - Caller-specified limit (may be `undefined`).
   * @returns The clamped character limit.
   */
  private resolveMaxChars(maxChars?: number): number {
    if (maxChars === undefined || maxChars === null || maxChars <= 0) {
      return this.defaultMaxChars;
    }
    return Math.min(maxChars, this.hardMaxChars);
  }

  /**
   * Fetch a URL, manually following redirects.
   *
   * Each redirect target is validated with {@link validatePublicUrl} before
   * being followed. Rate limiting ({@link waitForRateLimit}) is applied
   * before every request (including the initial one).
   *
   * Uses `fetch(url, { redirect: "manual" })` so that redirect responses
   * are returned as-is (with the 3xx status code and `Location` header
   * accessible), allowing per-hop URL validation.
   *
   * @param initialUrl - The URL to fetch.
   * @param cookieJar - Cookie store shared across the redirect chain.
   * @returns The final non-redirect response.
   * @throws {Error} On too many redirects, missing `Location` header,
   *   timeout, or SSRF validation failure.
   */
  private async fetchWithRedirects(
    initialUrl: string,
    cookieJar: CookieJar,
  ): Promise<InternalFetchResponse> {
    let currentUrl = initialUrl;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      // Validate the URL at every hop (defends against DNS rebinding).
      await validatePublicUrl(currentUrl);

      // Enforce rate limit before each request.
      await waitForRateLimit(this.minDelayMs);

      // Build request headers (including any cookies collected so far).
      const headers = this.buildHeaders(cookieJar);

      // Perform the fetch with timeout.
      const response = await this.fetchWithTimeout(currentUrl, headers);

      // Capture any Set-Cookie headers from the response.
      cookieJar.capture(response);

      // Handle redirects.
      if (isRedirect(response.status)) {
        if (hop === this.maxRedirects) {
          throw new Error("Too many redirects.");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            "Redirect response did not include a Location header.",
          );
        }
        // Resolve relative redirect targets against the current URL.
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      // Non-redirect response — read the (limited) body.
      const { bytes, limited } = await this.readLimitedBytes(response);

      return {
        finalUrl: currentUrl,
        statusCode: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bytes,
        bytesLimited: limited,
      };
    }

    // Loop exhausted without a non-redirect response.
    throw new Error("Too many redirects.");
  }

  /**
   * Perform a single `fetch` call with an `AbortController` timeout.
   *
   * Redirects are set to `"manual"` so that each redirect target can be
   * validated before following. The `AbortController` aborts the request
   * if it exceeds {@link timeoutMs}.
   *
   * @param url - The URL to fetch.
   * @param headers - Request headers.
   * @returns The fetch `Response`.
   * @throws {Error} If the request times out.
   */
  private async fetchWithTimeout(
    url: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `Request timed out after ${this.timeoutMs} ms: ${url}`,
        );
      }
      // Unwrap undici's generic "fetch failed" TypeError to expose the
      // underlying cause (e.g. "Connect Timeout Error", "ECONNREFUSED").
      if (
        err instanceof TypeError &&
        err.message === "fetch failed" &&
        err.cause instanceof Error
      ) {
        throw new Error(`Fetch failed for ${url}: ${err.cause.message}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Read the response body, limiting the total number of bytes.
   *
   * Reads the response body as a stream of `Uint8Array` chunks and
   * accumulates them into a `Buffer`. If the body exceeds
   * {@link maxResponseBytes}, the excess is discarded and `limited` is
   * set to `true`.
   *
   * The reader is always cancelled (in the `finally` block) to release
   * the underlying connection back to the pool.
   *
   * @param response - The fetch `Response` to read from.
   * @returns The body bytes and whether truncation occurred.
   */
  private async readLimitedBytes(
    response: Response,
  ): Promise<{ bytes: Buffer; limited: boolean }> {
    if (!response.body) {
      return { bytes: Buffer.alloc(0), limited: false };
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let limited = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = Buffer.from(value);

        if (totalLength + chunk.length > this.maxResponseBytes) {
          const remaining = this.maxResponseBytes - totalLength;
          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
            totalLength += remaining;
          }
          limited = true;
          break;
        }

        chunks.push(chunk);
        totalLength += chunk.length;
      }
    } finally {
      // Always cancel the reader to release the connection.
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors — the reader may already be closed.
      }
    }

    return {
      bytes: Buffer.concat(chunks, totalLength),
      limited,
    };
  }

  /**
   * Fetch the site homepage to collect cookies for a retry.
   *
   * Constructs the homepage URL from the origin of the URL that returned
   * 403/429 (e.g. `https://example.com/path` → `https://example.com/`),
   * then fetches it (following redirects) to populate the cookie jar.
   *
   * Errors are silently ignored — this is a best-effort operation. If the
   * homepage fetch fails, the retry will proceed without the cookies.
   *
   * @param finalUrl - The URL that returned 403/429.
   * @param cookieJar - Cookie store to populate.
   */
  private async fetchHomepageForCookies(
    finalUrl: string,
    cookieJar: CookieJar,
  ): Promise<void> {
    try {
      const parsed = new URL(finalUrl);
      const homepage = new URL("/", parsed.origin).href;
      await this.fetchWithRedirects(homepage, cookieJar);
    } catch {
      // Best-effort — ignore errors from the homepage fetch.
    }
  }

  /**
   * Build the request headers, including any stored cookies.
   *
   * @param cookieJar - Cookie store to read from.
   * @returns A headers object suitable for `fetch()`.
   */
  private buildHeaders(cookieJar: CookieJar): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: ACCEPT,
      "Accept-Language": ACCEPT_LANGUAGE,
    };
    const cookieHeader = cookieJar.toHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }
    return headers;
  }
}
