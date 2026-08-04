import type { Request, Response, NextFunction } from "express";
import { ErrorCode } from "../../domain/attachment/Result.js";
import { verify as verifySessionToken } from "../../auth/SessionToken.js";

/**
 * Express Request augmented with a verified session ID.
 * Set by `createRequireSessionId` middleware.
 */
export type AuthenticatedRequest = Request & { sessionId: string };

/**
 * Standardized error response builder.
 */
export function buildError(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  return {
    error: { code, message, ...(details ? { details } : {}) },
  };
}

/**
 * Send a standardized error response.
 */
export function sendError(res: Response, status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): void {
  res.status(status).json(buildError(code, message, details));
}

/**
 * Middleware factory: create a session ID verification middleware.
 *
 * When `secret` is non-empty, the `x-session-id` header is treated as a
 * signed token (`sessionId.hmacSignature`) and verified via HMAC-SHA256.
 * When `secret` is empty (localhost-only mode), the header value is used
 * directly without signature verification, preserving backward compatibility.
 *
 * @param secret - HMAC secret key. Empty string disables verification.
 * @returns Express middleware that extracts and validates the session ID.
 */
export function createRequireSessionId(secret: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers["x-session-id"] as string | undefined;
    if (!token || token.trim().length === 0) {
      sendError(res, 400, ErrorCode.SESSION_NOT_FOUND, "Missing x-session-id header");
      return;
    }

    const sessionId = verifySessionToken(token.trim(), secret);
    if (sessionId === null) {
      sendError(res, 401, ErrorCode.SESSION_NOT_FOUND, "Invalid or tampered session token");
      return;
    }

    (req as AuthenticatedRequest).sessionId = sessionId;
    next();
  };
}

/**
 * Legacy middleware: extract session ID from header without signature verification.
 * Kept for backward compatibility. Prefer `createRequireSessionId(secret)`.
 */
export const requireSessionId = createRequireSessionId("");

/**
 * Async route handler wrapper — catches promise rejections.
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Global error handler middleware.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[ERROR]", err);

  // Safely extract properties from the error (which is typed as unknown)
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    code?: string;
    message?: string;
    limit?: number;
  };

  // Multer errors
  if (e.code === "LIMIT_FILE_SIZE") {
    sendError(res, 413, ErrorCode.FILE_TOO_LARGE, `File exceeds size limit`, { maxSize: e.limit });
    return;
  }
  if (e.code === "LIMIT_FILE_COUNT") {
    sendError(res, 400, ErrorCode.INVALID_INPUT, "Too many files in batch", { maxBatch: e.limit });
    return;
  }

  // Known error codes
  if (e.code && Object.values(ErrorCode).includes(e.code as ErrorCode)) {
    const statusMap: Record<string, number> = {
      FILE_TOO_LARGE: 413,
      INVALID_EXTENSION: 400,
      SESSION_NOT_FOUND: 400,
      ATTACHMENT_NOT_FOUND: 404,
      RATE_LIMITED: 429,
      CLEAR_NOT_CONFIRMED: 400,
      INVALID_INPUT: 400,
      INTERNAL_ERROR: 500,
    };
    const status = statusMap[e.code] ?? 500;
    sendError(res, status, e.code as ErrorCode, e.message ?? e.code);
    return;
  }

  // Unknown errors
  sendError(res, 500, ErrorCode.INTERNAL_ERROR, "An unexpected error occurred");
}
