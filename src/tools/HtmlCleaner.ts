/**
 * HtmlCleaner — HTML cleaning and readable-text extraction utilities.
 *
 * Ported from the C# WebFetchToolProvider HTML cleaning logic.
 *
 * Provides:
 * - Byte decoding driven by the HTTP `Content-Type` charset.
 * - HTML tag / script / comment stripping with block-level line breaks.
 * - HTML entity decoding (numeric + common named entities).
 * - Whitespace normalization.
 * - `<title>` extraction.
 *
 * Uses only Node.js built-in APIs (`Buffer`, global `TextDecoder`).
 */

/** Result of readable text extraction. */
export interface ReadableTextResult {
  /** Extracted (and possibly truncated) text content. */
  text: string;
  /** Page title, or an empty string when not available. */
  title: string;
  /** Whether the text was truncated to fit `maxChars`. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Regexes used by cleanHtml
// ---------------------------------------------------------------------------

/**
 * Elements whose entire content should be removed together with the tags.
 * (script / style / noscript / svg)
 */
const STRIP_CONTENT_TAGS = /<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi;

/** Leftover opening / closing tags of the stripped-content element types. */
const STRIP_LEFTOVER_TAGS = /<\/?(?:script|style|noscript|svg)\b[^>]*>/gi;

/** Block-level tags that should introduce a line break. */
const BLOCK_TAGS =
  /<\/?(?:p|div|br|hr|h[1-6]|li|ul|ol|tr|td|th|thead|tbody|tfoot|caption|table|section|article|header|footer|main|nav|aside|figure|figcaption|blockquote|pre|dd|dl|dt|address|form|fieldset|legend|details|summary|hgroup|dialog|menu|option|optgroup|select)\b[^>]*>/gi;

/** Common HTML named entities. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  euro: "\u20ac",
  pound: "\u00a3",
  cent: "\u00a2",
  yen: "\u00a5",
  sect: "\u00a7",
  para: "\u00b6",
  middot: "\u00b7",
  bull: "\u2022",
  dagger: "\u2020",
  Dagger: "\u2021",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  infin: "\u221e",
  ne: "\u2260",
  le: "\u2264",
  ge: "\u2265",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  spades: "\u2660",
  clubs: "\u2663",
  hearts: "\u2665",
  diams: "\u2666",
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  pi: "\u03c0",
  sigma: "\u03c3",
  omega: "\u03c9",
  Alpha: "\u0391",
  Beta: "\u0392",
  Gamma: "\u0393",
  Delta: "\u0394",
  Pi: "\u03a0",
  Sigma: "\u03a3",
  Omega: "\u03a9",
};

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

/**
 * Extract the charset from a `Content-Type` header value.
 *
 * @returns The charset label (e.g. `utf-8`), or `null` when absent.
 */
function extractCharset(contentType: string): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match ? match[1] : null;
}

/**
 * Decode a byte buffer to a string using the charset declared in the
 * `Content-Type` header.
 *
 * Falls back to UTF-8 when no charset is declared. Non-UTF-8 encodings are
 * decoded with `TextDecoder`; if the encoding is unsupported by the runtime,
 * the bytes are decoded as Latin-1 to avoid data loss.
 *
 * @param contentType - The HTTP `Content-Type` header value.
 * @param bytes - The raw response bytes.
 * @returns The decoded string.
 */
export function decodeBytes(contentType: string, bytes: Buffer): string {
  const charset = (extractCharset(contentType) ?? "utf-8").toLowerCase();

  // Fast path for UTF-8 / ASCII.
  if (charset === "utf-8" || charset === "utf8" || charset === "ascii" || charset === "us-ascii") {
    let text = bytes.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
    return text;
  }

  // UTF-16LE via Buffer.
  if (charset === "utf-16le" || charset === "utf-16" || charset === "utf16le") {
    return bytes.toString("utf16le");
  }

  // Everything else (windows-1252, iso-8859-*, gbk, shift_jis, ...) via TextDecoder.
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/**
 * Decode HTML entities (numeric and a set of common named entities).
 *
 * Unknown named entities are left untouched.
 *
 * @param value - String potentially containing HTML entities.
 * @returns The entity-decoded string.
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, ent: string) => {
    if (ent.charCodeAt(0) === 35 /* '#' */) {
      if (ent.charCodeAt(1) === 120 || ent.charCodeAt(1) === 88 /* 'x' / 'X' */) {
        const code = parseInt(ent.slice(2), 16);
        return Number.isNaN(code) ? match : safeFromCodePoint(code);
      }
      const code = parseInt(ent.slice(1), 10);
      return Number.isNaN(code) ? match : safeFromCodePoint(code);
    }
    const decoded = NAMED_ENTITIES[ent.toLowerCase()];
    return decoded !== undefined ? decoded : match;
  });
}

/** Convert a code point to a string, substituting U+FFFD for invalid values. */
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "\uFFFD";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "\uFFFD";
  }
}

// ---------------------------------------------------------------------------
// Whitespace normalization
// ---------------------------------------------------------------------------

/**
 * Normalize whitespace in extracted text.
 *
 * - Converts `\r\n` and `\r` to `\n`.
 * - Collapses runs of spaces / tabs / non-breaking spaces into a single space.
 * - Removes spaces preceding common punctuation.
 * - Trims leading / trailing horizontal whitespace on every line.
 * - Collapses three or more consecutive newlines into two.
 * - Trims the overall result.
 *
 * @param value - The text to normalize.
 * @returns The whitespace-normalized text.
 */
export function normalizeWhitespace(value: string): string {
  let s = value;
  // Normalize line endings.
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\r/g, "\n");
  // Collapse horizontal whitespace runs (spaces, tabs, nbsp) to a single space.
  s = s.replace(/[ \t\u00a0]+/g, " ");
  // Remove spaces before common punctuation (Latin + CJK).
  s = s.replace(/ +([.,;:!?，。；：！？])/g, "$1");
  // Trim leading / trailing horizontal whitespace on each line.
  s = s.replace(/^[ \t\u00a0]+/gm, "");
  s = s.replace(/[ \t\u00a0]+$/gm, "");
  // Collapse 3+ consecutive newlines into at most two.
  s = s.replace(/\n{3,}/g, "\n\n");
  // Overall trim.
  return s.trim();
}

// ---------------------------------------------------------------------------
// HTML cleaning
// ---------------------------------------------------------------------------

/**
 * Extract the contents of the first `<title>` element from an HTML string.
 *
 * The extracted title is HTML-entity decoded and whitespace-normalized.
 *
 * @param html - Raw HTML markup.
 * @returns The decoded title, or an empty string when no title is found.
 */
export function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!match || match[1] === undefined) return "";
  return normalizeWhitespace(decodeHtmlEntities(match[1]));
}

/**
 * Clean an HTML string down to readable plain text.
 *
 * Steps:
 * 1. Remove `script`, `style`, `noscript` and `svg` elements together with
 *    their content.
 * 2. Remove HTML comments and CDATA sections.
 * 3. Remove DOCTYPE and other `<!...>` declarations.
 * 4. Convert block-level tags to line breaks.
 * 5. Remove all remaining tags (keeping their inner text).
 * 6. Decode HTML entities.
 * 7. Normalize whitespace.
 *
 * @param html - Raw HTML markup.
 * @returns Cleaned, readable plain text.
 */
export function cleanHtml(html: string): string {
  let s = html;
  // 1. Remove script/style/noscript/svg content + leftover tags of those types.
  s = s.replace(STRIP_CONTENT_TAGS, "");
  s = s.replace(STRIP_LEFTOVER_TAGS, "");
  // 2. Remove HTML comments and CDATA sections.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  // 3. Remove DOCTYPE / declarations.
  s = s.replace(/<![^>]*>/g, "");
  // 4. Block-level tags -> newline.
  s = s.replace(BLOCK_TAGS, "\n");
  // 5. Remove all remaining tags.
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  // 6. Decode HTML entities.
  s = decodeHtmlEntities(s);
  // 7. Normalize whitespace.
  s = normalizeWhitespace(s);
  return s;
}

// ---------------------------------------------------------------------------
// Readable text extraction
// ---------------------------------------------------------------------------

/**
 * Truncate text to `maxChars`, reporting whether truncation occurred.
 *
 * @param text - The full text.
 * @param maxChars - Maximum number of characters to keep (clamped to >= 0).
 * @param title - The page title to carry through.
 * @returns A {@link ReadableTextResult}.
 */
function truncate(text: string, maxChars: number, title: string): ReadableTextResult {
  const limit = Math.max(0, Math.floor(maxChars));
  if (text.length <= limit) {
    return { text, title, truncated: false };
  }
  return { text: text.slice(0, limit), title, truncated: true };
}

/**
 * Build a safe textual preview of binary content (file size + hex dump).
 *
 * @param bytes - The raw binary bytes.
 * @returns A printable, control-character-free preview string.
 */
function binaryPreview(bytes: Buffer): string {
  if (bytes.length === 0) return "[Empty binary content]";
  const sample = bytes.subarray(0, 256);
  const hex = sample.toString("hex");
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return `[Binary content, ${bytes.length} bytes]\n${pairs.join(" ")}`;
}

/**
 * Extract readable text from an HTTP response body.
 *
 * Behavior depends on the `Content-Type`:
 * - **HTML** (`text/html`, `application/xhtml+xml`): decode bytes, extract the
 *   page title, then clean the HTML to plain text.
 * - **Other text** (`text/*`, JSON, XML, JavaScript): decode and normalize
 *   whitespace.
 * - **Binary**: produce a safe textual preview (file size + hex dump).
 *
 * The result is truncated to `maxChars` when necessary.
 *
 * @param contentType - The HTTP `Content-Type` header value.
 * @param bytes - The raw response body bytes.
 * @param maxChars - Maximum number of characters to return.
 * @returns An object with the extracted `text`, `title` and `truncated` flag.
 */
export function extractReadableText(
  contentType: string,
  bytes: Buffer,
  maxChars: number,
): ReadableTextResult {
  const ct = (contentType ?? "").toLowerCase();

  // HTML.
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) {
    const html = decodeBytes(contentType, bytes);
    const title = extractTitle(html);
    const cleaned = cleanHtml(html);
    return truncate(cleaned, maxChars, title);
  }

  // Other text-like content.
  if (
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("ecmascript")
  ) {
    const text = normalizeWhitespace(decodeBytes(contentType, bytes));
    return truncate(text, maxChars, "");
  }

  // Non-text (binary) content — produce a safe preview.
  return truncate(binaryPreview(bytes), maxChars, "");
}
