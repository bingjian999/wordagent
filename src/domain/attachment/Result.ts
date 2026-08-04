/**
 * Result type for service operations.
 * Following the Result pattern for explicit error handling without exceptions.
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Standard error codes used across the application.
 * These map to the standardized error response format.
 */
export enum ErrorCode {
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  INVALID_EXTENSION = "INVALID_EXTENSION",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  ATTACHMENT_NOT_FOUND = "ATTACHMENT_NOT_FOUND",
  RATE_LIMITED = "RATE_LIMITED",
  CLEAR_NOT_CONFIRMED = "CLEAR_NOT_CONFIRMED",
  INVALID_INPUT = "INVALID_INPUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Standardized error response format for HTTP API.
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Create a success result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create an error result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
