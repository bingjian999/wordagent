/**
 * Calculator Tool
 *
 * A high-level wrapper around the {@link ExpressionEvaluator} that evaluates
 * financial/accounting expressions and returns a structured result object.
 *
 * Ported from the C# `CalculatorToolProvider.CalcEvalExpression` method.
 * Unlike the C# version (which returns a JSON string), this TypeScript
 * implementation returns a plain structured object so callers can work with
 * typed data directly.
 *
 * Features:
 * - Evaluates expressions via the shared {@link evaluate} function.
 * - Formats the numeric result via {@link formatDecimal}.
 * - Measures execution time in milliseconds using `performance.now()`.
 * - Captures all errors and returns them in a structured error result.
 * - Returns a discriminated union (`ok: true | false`) for type-safe handling.
 *
 * @module CalculatorTool
 */

import {
  evaluate,
  formatDecimal,
  type ExpressionEvaluation,
} from "./ExpressionEvaluator.js";

// ============================================================================
// Result Types
// ============================================================================

/**
 * Successful evaluation result.
 *
 * Returned when the expression could be parsed and evaluated without error.
 */
export interface CalculatorSuccessResult {
  /** Always `true`, indicating a successful evaluation. */
  ok: true;
  /** The original expression string passed to `evalExpression`. */
  expression: string;
  /** The normalized expression (token texts joined by spaces). */
  normalizedExpression: string;
  /** The computed numeric result. */
  result: number;
  /** The formatted result text (trailing zeros removed). */
  resultText: string;
  /** Total execution time in milliseconds. */
  durationMs: number;
}

/**
 * Failed evaluation result.
 *
 * Returned when the expression could not be parsed or evaluated (for example,
 * invalid syntax, division by zero, or unsupported characters).
 */
export interface CalculatorErrorResult {
  /** Always `false`, indicating a failed evaluation. */
  ok: false;
  /** The original expression string passed to `evalExpression`. */
  expression: string;
  /** The human-readable error message. */
  error: string;
  /** Total execution time in milliseconds. */
  durationMs: number;
}

/**
 * The structured result of evaluating a calculator expression.
 *
 * This is a discriminated union: narrow on the `ok` property to obtain
 * type-safe access to the success or error fields.
 *
 * @example
 * ```ts
 * const tool = new CalculatorTool();
 * const res = tool.evalExpression("1 + 2 * 3");
 * if (res.ok) {
 *   console.log(res.resultText); // "7"
 * } else {
 *   console.error(res.error);
 * }
 * ```
 */
export type CalculatorResult =
  | CalculatorSuccessResult
  | CalculatorErrorResult;

// ============================================================================
// CalculatorTool
// ============================================================================

/**
 * Calculator tool that evaluates financial/accounting expressions.
 *
 * This class is a thin, stateless wrapper around the {@link evaluate} and
 * {@link formatDecimal} functions. It adds execution-time measurement and
 * structured error handling, mirroring the C# `CalculatorToolProvider`.
 *
 * @example
 * ```ts
 * const tool = new CalculatorTool();
 * const result = tool.evalExpression("(123.45) + 50%");
 * if (result.ok) {
 *   console.log(result.result);     // -73.45
 *   console.log(result.resultText); // "-73.45"
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export class CalculatorTool {
  /**
   * Evaluates a financial/accounting expression and returns a structured
   * result object.
   *
   * The expression is normalized (full-width → ASCII), tokenized, and parsed
   * with standard operator precedence. See {@link evaluate} for the full list
   * of supported features (unit suffixes, percent, accounting negatives, etc.).
   *
   * On success, returns a {@link CalculatorSuccessResult} containing the
   * normalized expression, numeric result, formatted result text, and the
   * execution duration in milliseconds.
   *
   * On failure (invalid syntax, division by zero, unsupported characters,
   * expression too long, etc.), returns a {@link CalculatorErrorResult}
   * containing the error message and execution duration. All exceptions are
   * caught so this method never throws.
   *
   * @param expression - The expression string to evaluate. May be empty,
   *                     in which case an error result is returned.
   * @returns A discriminated union result. Check the `ok` property to
   *          determine success or failure.
   *
   * @example
   * ```ts
   * const tool = new CalculatorTool();
   *
   * // Success
   * tool.evalExpression("1,234.56 + 1万元");
   * // → { ok: true, expression: "1,234.56 + 1万元",
   * //     normalizedExpression: "1234.56 + 10000", result: 11234.56,
   * //     resultText: "11234.56", durationMs: 0 }
   *
   * // Error (division by zero)
   * tool.evalExpression("1 / 0");
   * // → { ok: false, expression: "1 / 0",
   * //     error: "Division by zero.", durationMs: 0 }
   * ```
   */
  evalExpression(expression: string): CalculatorResult {
    // Defensive default mirroring the C# `expression ?? string.Empty`.
    const expr = expression ?? "";

    const start = performance.now();

    try {
      const evaluation: ExpressionEvaluation = evaluate(expr);
      const durationMs = Math.round(performance.now() - start);

      return {
        ok: true,
        expression: expr,
        normalizedExpression: evaluation.normalizedExpression,
        result: evaluation.result,
        resultText: formatDecimal(evaluation.result),
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      return {
        ok: false,
        expression: expr,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      };
    }
  }
}
