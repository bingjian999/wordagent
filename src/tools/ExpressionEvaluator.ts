/**
 * Expression Evaluator
 *
 * A financial/accounting expression evaluator ported from the C#
 * CalculatorExpressionEvaluator. Supports full-width character normalization,
 * accounting negative notation, unit suffixes, percent suffixes, and
 * standard arithmetic with proper operator precedence.
 *
 * Features:
 * - Full-width character normalization (digits, commas, periods, parentheses, operators, percent, space)
 * - Accounting negative notation: (123.45) → -123.45
 * - Unit suffixes: 万元(×10000), 万(×10000), 千元(×1000), 千(×1000), 元(no-op)
 * - Percent suffix: 50% → 0.5
 * - Thousand separators: 1,234.56
 * - Dash characters (–, —) treated as zero
 * - Currency symbols (¥, ￥) ignored
 * - Recursive descent parsing with proper operator precedence (+, -, *, /)
 * - Expression length and token count limits
 *
 * @module ExpressionEvaluator
 */

// ============================================================================
// Constants
// ============================================================================

/** Maximum allowed expression length in characters. */
const MAX_EXPRESSION_LENGTH = 8000;

/** Maximum allowed number of tokens (including the End sentinel). */
const MAX_TOKEN_COUNT = 1000;

// ============================================================================
// Token Types
// ============================================================================

/**
 * Kinds of tokens produced by the tokenizer.
 *
 * Numeric values match the original C# enum for compatibility
 * with the accounting-negative validation logic.
 */
enum TokenKind {
  /** A numeric literal. */
  Number = 0,
  /** An arithmetic operator: +, -, *, /. */
  Operator = 1,
  /** A left parenthesis '('. */
  LeftParen = 2,
  /** A right parenthesis ')'. */
  RightParen = 3,
  /** End-of-input sentinel token. */
  End = 4,
}

/**
 * A single token produced by the tokenizer.
 */
interface Token {
  /** The token kind. */
  kind: TokenKind;
  /** The normalized text representation of the token. */
  text: string;
  /** The operator character, or '\0' for non-operator tokens. */
  operator: string;
  /** The numeric value, or 0 for non-number tokens. */
  value: number;
}

// ============================================================================
// Public Interface
// ============================================================================

/**
 * Result of evaluating an expression.
 */
export interface ExpressionEvaluation {
  /** The computed numeric result. */
  result: number;
  /** The normalized expression: all token texts joined by spaces. */
  normalizedExpression: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if a character is an ASCII digit (0-9).
 *
 * @param c - A single character string.
 * @returns True if the character is a digit 0-9.
 */
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

/**
 * Checks if a character is whitespace.
 *
 * Equivalent to C# {@code char.IsWhiteSpace}. Handles regular space,
 * tab, newline, carriage return, ideographic space (after normalization),
 * and other Unicode whitespace.
 *
 * @param c - A single character string.
 * @returns True if the character is whitespace.
 */
function isWhitespace(c: string): boolean {
  return /\s/.test(c);
}

// ============================================================================
// Character Normalization
// ============================================================================

/**
 * Normalizes full-width and special characters to their ASCII equivalents.
 *
 * Transformations:
 * - Full-width digits ０-９ (U+FF10..U+FF19) → ASCII 0-9
 * - Full-width comma ，(U+FF0C) and Arabic thousands separator ٬(U+066C) → ,
 * - Full-width period 。(U+3002) and ．(U+FF0E) → .
 * - Full-width parentheses （(U+FF08) ）(U+FF09) → ( )
 * - Full-width plus ＋(U+FF0B) → +
 * - Full-width minus －(U+FF0D) → -
 * - Multiplication signs ×(U+00D7) ✕(U+2715) → *
 * - Division sign ÷(U+00F7) → /
 * - Full-width percent ％(U+FF05) → %
 * - Ideographic space U+3000 → regular space
 *
 * Note: En-dash (–, U+2013) and em-dash (—, U+2014) are NOT normalized
 * here; they are handled by the tokenizer as zero.
 *
 * @param expression - The raw input expression.
 * @returns The normalized expression with ASCII characters.
 */
function normalizeCharacters(expression: string): string {
  const chars: string[] = [];
  for (const c of expression) {
    // Full-width digits ０-９ (U+FF10..U+FF19) → ASCII 0-9 (U+0030..U+0039)
    if (c >= "０" && c <= "９") {
      chars.push(String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
      continue;
    }
    switch (c) {
      case "٬": // U+066C Arabic thousands separator
      case "，": // U+FF0C full-width comma
        chars.push(",");
        break;
      case "。": // U+3002 ideographic full stop
      case "．": // U+FF0E full-width full stop
        chars.push(".");
        break;
      case "（": // U+FF08 full-width left parenthesis
        chars.push("(");
        break;
      case "）": // U+FF09 full-width right parenthesis
        chars.push(")");
        break;
      case "＋": // U+FF0B full-width plus sign
        chars.push("+");
        break;
      case "－": // U+FF0D full-width hyphen-minus
        chars.push("-");
        break;
      case "×": // U+00D7 multiplication sign
      case "✕": // U+2715 multiplication X
        chars.push("*");
        break;
      case "÷": // U+00F7 division sign
        chars.push("/");
        break;
      case "％": // U+FF05 full-width percent sign
        chars.push("%");
        break;
      case "\u3000": // ideographic space
        chars.push(" ");
        break;
      default:
        chars.push(c);
        break;
    }
  }
  return chars.join("");
}

// ============================================================================
// Number Parsing
// ============================================================================

/**
 * Parses a raw number string (which may contain commas and a decimal point)
 * into a numeric value.
 *
 * Commas are stripped, and the remaining text must consist of digits with
 * at most one decimal point. Equivalent to C# {@code ParseDecimal} which
 * uses {@code decimal.TryParse} with {@code NumberStyles.AllowDecimalPoint}.
 *
 * @param rawNumber - The raw number string from the expression.
 * @returns The parsed numeric value.
 * @throws {Error} If the number is invalid (empty, multiple decimal points, non-numeric).
 */
function parseDecimal(rawNumber: string): number {
  const text = rawNumber.replace(/,/g, "");
  if (text.trim() === "" || text === ".") {
    throw new Error("Invalid number: " + rawNumber);
  }
  // Reject multiple decimal points
  const dotCount = (text.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    throw new Error("Invalid number: " + rawNumber);
  }
  // Validate format: only digits and at most one decimal point
  if (!/^\d*\.?\d*$/.test(text)) {
    throw new Error("Invalid number: " + rawNumber);
  }
  const result = parseFloat(text);
  if (Number.isNaN(result)) {
    throw new Error("Invalid number: " + rawNumber);
  }
  return result;
}

// ============================================================================
// Accounting Number Detection
// ============================================================================

/**
 * Determines whether the text inside parentheses looks like an accounting
 * number (e.g., "123.45", "1,234.56", "123元").
 *
 * Rules:
 * 1. Must not be empty or whitespace-only.
 * 2. Must not contain arithmetic operators +, *, / (note: - is allowed).
 * 3. If none of the numeric/accounting indicators (, . % ¥ ￥ 万 千) are
 *    present, the text must contain 元 to be considered an accounting number.
 *
 * This is a quick pre-filter; the actual validation is done by recursively
 * tokenizing the inner text and checking that it produces exactly one number.
 *
 * @param inner - The text between parentheses (already normalized).
 * @returns True if the text looks like an accounting number.
 */
function looksLikeAccountingNumber(inner: string): boolean {
  if (inner.trim() === "") {
    return false;
  }
  // Reject if it contains arithmetic operators (note: '-' is NOT rejected here)
  if (inner.includes("+") || inner.includes("*") || inner.includes("/")) {
    return false;
  }
  // If no numeric/accounting indicators are present, require '元'
  if (
    !inner.includes(",") &&
    !inner.includes(".") &&
    !inner.includes("%") &&
    !inner.includes("¥") &&
    !inner.includes("￥") &&
    !inner.includes("万") &&
    !inner.includes("千")
  ) {
    return inner.includes("元");
  }
  return true;
}

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Tokenizer that converts a normalized expression string into a list of tokens.
 *
 * Handles:
 * - Numeric literals with optional unit suffixes (万元, 万, 千元, 千, 元)
 *   and percent suffix (%)
 * - Arithmetic operators (+, -, *, /)
 * - Parentheses (including accounting negative notation)
 * - Currency symbols (¥, ￥) — silently skipped
 * - Dash characters (– U+2013, — U+2014) — treated as zero
 * - Maximum token count enforcement
 */
class Tokenizer {
  private readonly _expression: string;
  private readonly _tokens: Token[] = [];
  private _index = 0;

  /**
   * @param expression - The normalized expression to tokenize.
   */
  constructor(expression: string) {
    this._expression = expression ?? "";
  }

  /**
   * Tokenizes the expression.
   *
   * @returns An array of tokens, ending with an End sentinel token.
   * @throws {Error} If the expression contains unsupported characters
   *         or exceeds the maximum token count.
   */
  tokenize(): Token[] {
    while (this._index < this._expression.length) {
      const c = this._expression[this._index];

      // Whitespace — skip
      if (isWhitespace(c)) {
        this._index++;
        continue;
      }

      // Currency symbols — silently skip
      if (c === "¥" || c === "￥") {
        this._index++;
        continue;
      }

      // Dash characters (en-dash U+2013, em-dash U+2014) — treat as zero
      if (c === "–" || c === "—") {
        this.addNumber(0, "0");
        this._index++;
        continue;
      }

      // Numeric literal (starts with digit or decimal point)
      if (isDigit(c) || c === ".") {
        const { value, normalizedText } = this.parseNumberToken();
        this.addNumber(value, normalizedText);
        continue;
      }

      // Left parenthesis — try accounting negative notation first
      if (c === "(") {
        const result = this.tryParseAccountingNegative();
        if (result.success) {
          this.addNumber(result.value, result.normalizedText);
          continue;
        }
        // Not an accounting negative — treat as regular left parenthesis
        this.add({
          kind: TokenKind.LeftParen,
          text: "(",
          operator: "\0",
          value: 0,
        });
        this._index++;
        continue;
      }

      // Arithmetic operators
      if (c === "*" || c === "+" || c === "-" || c === "/") {
        this.add({
          kind: TokenKind.Operator,
          text: c,
          operator: c,
          value: 0,
        });
        this._index++;
        continue;
      }

      // Right parenthesis
      if (c === ")") {
        this.add({
          kind: TokenKind.RightParen,
          text: ")",
          operator: "\0",
          value: 0,
        });
        this._index++;
        continue;
      }

      // Unsupported character
      throw new Error("Expression contains an unsupported character: " + c);
    }

    // End sentinel
    this.add({ kind: TokenKind.End, text: "", operator: "\0", value: 0 });
    return this._tokens;
  }

  /**
   * Adds a number token to the token list.
   *
   * @param value - The numeric value.
   * @param text - The normalized text representation.
   */
  private addNumber(value: number, text: string): void {
    this.add({ kind: TokenKind.Number, text, operator: "\0", value });
  }

  /**
   * Adds a token to the token list, enforcing the maximum token count.
   *
   * @param token - The token to add.
   * @throws {Error} If the token count exceeds the maximum.
   */
  private add(token: Token): void {
    if (this._tokens.length >= MAX_TOKEN_COUNT) {
      throw new Error("Expression contains too many terms.");
    }
    this._tokens.push(token);
  }

  /**
   * Parses a numeric literal starting at the current index.
   *
   * Reads consecutive digits, commas, and decimal points, then applies
   * unit suffixes (万元, 万, 千元, 千, 元) followed by percent suffix (%).
   *
   * @returns The parsed value and its normalized text representation.
   */
  private parseNumberToken(): { value: number; normalizedText: string } {
    const start = this._index;
    while (
      this._index < this._expression.length &&
      (isDigit(this._expression[this._index]) ||
        this._expression[this._index] === "," ||
        this._expression[this._index] === ".")
    ) {
      this._index++;
    }
    let value = parseDecimal(
      this._expression.substring(start, this._index),
    );
    value = this.applyUnitSuffix(value);
    value = this.applyPercentSuffix(value);
    const normalizedText = formatDecimal(value);
    return { value, normalizedText };
  }

  /**
   * Attempts to parse an accounting negative number enclosed in parentheses.
   *
   * Accounting notation represents negative values as (123.45) meaning
   * -123.45. This method checks if the text between the current '(' and
   * the next ')' is a valid single number, and if so, negates it.
   *
   * If successful, the index is advanced past the ')'. If not, the index
   * remains unchanged and the caller should treat '(' as a regular left
   * parenthesis.
   *
   * @returns An object with success flag, value, and normalized text.
   */
  private tryParseAccountingNegative(): {
    success: boolean;
    value: number;
    normalizedText: string;
  } {
    const closeIndex = this._expression.indexOf(")", this._index + 1);
    if (closeIndex < 0) {
      return { success: false, value: 0, normalizedText: "" };
    }
    const text = this._expression
      .substring(this._index + 1, closeIndex)
      .trim();
    if (!looksLikeAccountingNumber(text)) {
      return { success: false, value: 0, normalizedText: "" };
    }
    // Recursively tokenize the inner text
    const innerTokens = new Tokenizer(text).tokenize();
    // Must be exactly: [Number, End]
    if (
      innerTokens.length !== 2 ||
      innerTokens[0].kind !== TokenKind.Number
    ) {
      return { success: false, value: 0, normalizedText: "" };
    }
    const value = -innerTokens[0].value;
    const normalizedText = "(" + formatDecimal(value) + ")";
    this._index = closeIndex + 1;
    return { success: true, value, normalizedText };
  }

  /**
   * Applies a unit suffix to the value, advancing the index past the suffix.
   *
   * Supported suffixes (checked in order):
   * - 万元 → ×10000 (index advances 2)
   * - 万 → ×10000 (index advances 1)
   * - 千元 → ×1000 (index advances 2)
   * - 千 → ×1000 (index advances 1)
   * - 元 → no change (index advances 1, suffix consumed)
   *
   * @param value - The current numeric value.
   * @returns The value after applying the unit suffix.
   */
  private applyUnitSuffix(value: number): number {
    if (this.startsWith("万元")) {
      this._index += 2;
      return value * 10000;
    }
    if (this.startsWith("万")) {
      this._index += 1;
      return value * 10000;
    }
    if (this.startsWith("千元")) {
      this._index += 2;
      return value * 1000;
    }
    if (this.startsWith("千")) {
      this._index += 1;
      return value * 1000;
    }
    if (this.startsWith("元")) {
      this._index += 1;
    }
    return value;
  }

  /**
   * Applies a percent suffix, dividing by 100 if '%' follows the number.
   *
   * @param value - The current numeric value.
   * @returns The value after applying the percent suffix.
   */
  private applyPercentSuffix(value: number): number {
    if (
      this._index < this._expression.length &&
      this._expression[this._index] === "%"
    ) {
      this._index++;
      return value / 100;
    }
    return value;
  }

  /**
   * Checks if the expression at the current index starts with the given text.
   *
   * @param text - The text to check for.
   * @returns True if the expression starts with the text at the current index.
   */
  private startsWith(text: string): boolean {
    if (text.length === 0) {
      return false;
    }
    return this._expression.startsWith(text, this._index);
  }
}

// ============================================================================
// Parser (Recursive Descent)
// ============================================================================

/**
 * Recursive descent parser for arithmetic expressions.
 *
 * Grammar:
 * ```
 * expression → term (('+' | '-') term)*
 * term       → factor (('*' | '/') factor)*
 * factor     → ('+' | '-') factor | number | '(' expression ')'
 * ```
 *
 * Operator precedence (lowest to highest):
 * 1. Addition / Subtraction (+, -)
 * 2. Multiplication / Division (*, /)
 * 3. Unary plus/minus, numbers, parenthesized expressions
 */
class Parser {
  private readonly _tokens: readonly Token[];
  private _index = 0;

  /**
   * @param tokens - The token list (including End sentinel) to parse.
   */
  constructor(tokens: readonly Token[]) {
    this._tokens = tokens;
  }

  /** The current token being examined. */
  private get current(): Token {
    return this._tokens[this._index];
  }

  /**
   * Parses the full expression and returns the result.
   *
   * @returns The computed numeric result.
   * @throws {Error} If there are unexpected tokens remaining after parsing.
   */
  parse(): number {
    const result = this.parseExpression();
    if (this.current.kind !== TokenKind.End) {
      throw new Error("Unexpected token: " + this.current.text);
    }
    return result;
  }

  /**
   * Parses an expression: term (('+' | '-') term)*
   *
   * Addition and subtraction are left-associative.
   *
   * @returns The computed numeric result.
   */
  private parseExpression(): number {
    let left = this.parseTerm();
    while (
      this.current.kind === TokenKind.Operator &&
      (this.current.operator === "+" || this.current.operator === "-")
    ) {
      const op = this.current.operator;
      this.advance();
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  /**
   * Parses a term: factor (('*' | '/') factor)*
   *
   * Multiplication and division are left-associative.
   *
   * @returns The computed numeric result.
   * @throws {Error} On division by zero.
   */
  private parseTerm(): number {
    let left = this.parseFactor();
    while (
      this.current.kind === TokenKind.Operator &&
      (this.current.operator === "*" || this.current.operator === "/")
    ) {
      const op = this.current.operator;
      this.advance();
      const right = this.parseFactor();
      left = op === "*" ? left * right : this.divide(left, right);
    }
    return left;
  }

  /**
   * Parses a factor: ('+' | '-') factor | number | '(' expression ')'
   *
   * Handles unary plus/minus, numeric literals, and parenthesized
   * sub-expressions.
   *
   * @returns The computed numeric result.
   * @throws {Error} If a number or parenthesized expression was expected
   *         but not found, or if a closing parenthesis is missing.
   */
  private parseFactor(): number {
    // Unary plus/minus
    if (
      this.current.kind === TokenKind.Operator &&
      (this.current.operator === "+" || this.current.operator === "-")
    ) {
      const op = this.current.operator;
      this.advance();
      const value = this.parseFactor();
      return op === "-" ? -value : value;
    }

    // Numeric literal
    if (this.current.kind === TokenKind.Number) {
      const value = this.current.value;
      this.advance();
      return value;
    }

    // Parenthesized expression
    if (this.current.kind === TokenKind.LeftParen) {
      this.advance();
      const result = this.parseExpression();
      // Re-read current into a local to avoid TypeScript control-flow
      // narrowing (advance/parseExpression mutate _index, changing current)
      const closeToken = this.current;
      if (closeToken.kind !== TokenKind.RightParen) {
        throw new Error("Missing closing parenthesis.");
      }
      this.advance();
      return result;
    }

    throw new Error("Expected a number or parenthesized expression.");
  }

  /**
   * Divides two numbers, checking for division by zero.
   *
   * @param left - The dividend.
   * @param right - The divisor.
   * @returns The quotient.
   * @throws {Error} If the divisor is zero.
   */
  private divide(left: number, right: number): number {
    if (right === 0) {
      throw new Error("Division by zero.");
    }
    return left / right;
  }

  /**
   * Advances to the next token, stopping at the End sentinel
   * to avoid out-of-bounds access.
   */
  private advance(): void {
    if (this._index < this._tokens.length - 1) {
      this._index++;
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Formats a number by removing trailing zeros after the decimal point.
 *
 * Equivalent to the C# format string {@code "0.############################"}
 * — at least one digit before the decimal point, up to 28 decimal places
 * with trailing zeros removed, and no trailing decimal point.
 *
 * Examples:
 * - 0 → "0"
 * - 42 → "42"
 * - 3.14 → "3.14"
 * - 123.450 → "123.45"
 * - -123.45 → "-123.45"
 *
 * Note: JavaScript numbers (IEEE 754 double) have ~15-17 significant digits
 * of precision, which may produce different results than C# {@code decimal}
 * for very large or high-precision values.
 *
 * @param value - The numeric value to format.
 * @returns The formatted string representation.
 */
export function formatDecimal(value: number): string {
  if (!isFinite(value)) {
    return String(value);
  }
  // Handle zero (including negative zero)
  if (value === 0) {
    return "0";
  }
  let str = String(value);
  // Convert exponential notation to fixed notation, then trim trailing zeros
  if (str.includes("e") || str.includes("E")) {
    str = value.toFixed(20).replace(/\.?0+$/, "");
  }
  return str;
}

/**
 * Evaluates a financial/accounting expression and returns the result.
 *
 * The expression is first normalized (full-width → ASCII), then tokenized,
 * then parsed using a recursive descent parser with standard operator
 * precedence.
 *
 * Supported features:
 * - Standard arithmetic: {@code +}, {@code -}, {@code *}, {@code /} with
 *   proper precedence (multiplication/division before addition/subtraction)
 * - Parentheses for grouping: {@code (1 + 2) * 3}
 * - Accounting negative notation: {@code (123.45)} → {@code -123.45}
 * - Unit suffixes: {@code 万元}(×10000), {@code 万}(×10000),
 *   {@code 千元}(×1000), {@code 千}(×1000), {@code 元}(no-op)
 * - Percent suffix: {@code 50%} → {@code 0.5}
 * - Thousand separators: {@code 1,234.56}
 * - Full-width character normalization
 * - Dash characters ({@code –}, {@code —}) as zero
 * - Currency symbols ({@code ¥}, {@code ￥}) — ignored
 *
 * @param expression - The expression string to evaluate.
 * @returns An object with the numeric result and the normalized expression
 *          (all token texts joined by spaces).
 * @throws {Error} If the expression is empty, too long (>8000 chars),
 *         contains too many tokens (>1000), has invalid syntax,
 *         divides by zero, or contains unsupported characters.
 */
export function evaluate(expression: string): ExpressionEvaluation {
  if (expression == null || expression.trim() === "") {
    throw new Error("Expression is empty.");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error("Expression is too long.");
  }

  const normalized = normalizeCharacters(expression);
  const tokens = new Tokenizer(normalized).tokenize();
  const result = new Parser(tokens).parse();

  const normalizedExpression = tokens
    .filter((t) => t.kind !== TokenKind.End)
    .map((t) => t.text)
    .join(" ");

  return { result, normalizedExpression };
}