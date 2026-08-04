import * as os from "node:os";

/**
 * Supported newline character sequences.
 */
export type Newline = "\r\n" | "\n" | "\r";

/**
 * LineDocument — a text document model based on lines.
 *
 * Ported from the C# `LineDocument` class. Provides:
 * - Parsing text into a line array while detecting the original newline style.
 * - Normalizing mixed newlines for uniform processing.
 * - Rendering lines back to text using the original newline conventions.
 *
 * The class is immutable in its properties (`lines`, `newline`,
 * `trailingNewline` are `readonly`), though the `lines` array contents may
 * be mutated by callers performing line-level edits.
 *
 * @example
 * ```ts
 * const doc = LineDocument.parse("a\nb\n");
 * doc.lines;             // ["a", "b"]
 * doc.newline;           // "\n"
 * doc.trailingNewline;   // true
 * doc.render();          // "a\nb\n"
 * ```
 */
export class LineDocument {
  /**
   * The document lines, **without** newline terminators.
   * For empty input this is `[""]` (a single empty line), matching the
   * C# reference behavior.
   */
  readonly lines: string[];

  /**
   * The detected newline style used by the original text.
   * One of `"\r\n"`, `"\n"`, or `"\r"`. When the input contains no newline
   * at all, the platform default (`os.EOL`) is used.
   */
  readonly newline: Newline;

  /**
   * Whether the original text ended with a trailing newline.
   * When `true`, {@link LineDocument.render} appends a final newline.
   */
  readonly trailingNewline: boolean;

  /**
   * Construct a LineDocument from pre-split lines.
   *
   * In most cases you should use {@link LineDocument.parse} to create an
   * instance from raw text. This constructor is useful when you already
   * have lines and want to specify the newline style explicitly.
   *
   * @param lines - The lines (without terminators).
   * @param newline - The newline style to use when rendering.
   * @param trailingNewline - Whether rendering should append a trailing newline.
   */
  constructor(
    lines: string[],
    newline: Newline,
    trailingNewline: boolean,
  ) {
    this.lines = lines;
    this.newline = newline;
    this.trailingNewline = trailingNewline;
  }

  /**
   * Parse raw text into a {@link LineDocument}.
   *
   * Algorithm (mirrors the C# reference):
   * 1. Detect the newline style: check for `\r\n` first, then `\n`, then
   *    `\r`; fall back to `os.EOL` when none is found.
   * 2. Normalize all newlines in the text to `\n` so splitting is uniform.
   * 3. Record whether the normalized text ends with a trailing newline.
   * 4. If a trailing newline is present, remove it (so the final empty
   *    segment is not counted as an extra line).
   * 5. Split by `\n`. Empty input yields `[""]`.
   *
   * @param text - The raw text to parse.
   * @returns A new {@link LineDocument}.
   */
  static parse(text: string): LineDocument {
    // 1. Detect the newline style
    const newline = LineDocument.detectNewline(text);

    // 2. Normalize all newlines to \n
    const normalized = LineDocument.normalizeNewlines(text);

    // 3. Record whether there is a trailing newline
    const trailingNewline =
      normalized.length > 0 && normalized.endsWith("\n");

    // 4. Strip the single trailing newline if present
    const body = trailingNewline
      ? normalized.substring(0, normalized.length - 1)
      : normalized;

    // 5. Split into lines (empty string -> [""])
    const lines = body.split("\n");

    return new LineDocument(lines, newline, trailingNewline);
  }

  /**
   * Split content into lines using normalized (`\n`) newlines.
   *
   * This is a lightweight helper that normalizes `\r\n` and lone `\r` to
   * `\n` and then splits. Unlike {@link LineDocument.parse}, it does **not**
   * strip a trailing newline, so a trailing `\n` produces a final `""`
   * element. This is useful for diffing where the trailing newline matters.
   *
   * @param content - The text to split.
   * @returns An array of lines.
   */
  static splitContentLines(content: string): string[] {
    return LineDocument.normalizeNewlines(content).split("\n");
  }

  /**
   * Render the document back to a string using the original newline style.
   *
   * Lines are joined with {@link LineDocument.newline}; if
   * {@link LineDocument.trailingNewline} is `true`, a final newline is
   * appended.
   *
   * @returns The rendered text.
   */
  render(): string {
    const joined = this.lines.join(this.newline);
    return this.trailingNewline ? joined + this.newline : joined;
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  /**
   * Detect the dominant newline style of the text.
   *
   * Detection order: `\r\n` → `\n` → `\r` → `os.EOL` (platform default).
   * The first match wins, which means a document mixing `\r\n` and `\n`
   * is treated as `\r\n`.
   */
  private static detectNewline(text: string): Newline {
    if (text.includes("\r\n")) return "\r\n";
    if (text.includes("\n")) return "\n";
    if (text.includes("\r")) return "\r";
    return os.EOL as Newline;
  }

  /**
   * Normalize all newline styles in the text to `\n`.
   *
   * `\r\n` is replaced first to avoid turning it into two line breaks,
   * then any remaining lone `\r` is replaced.
   */
  private static normalizeNewlines(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
}
