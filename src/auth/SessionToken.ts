import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SessionToken — HMAC-based session ID signing and verification.
 *
 * Prevents session ID spoofing by requiring callers to present a
 * cryptographic signature alongside their session ID. The signature
 * is computed via HMAC-SHA256 using a server-side secret.
 *
 * Token format: `sessionId.base64url(hmacSha256(sessionId, secret))`
 *
 * When no secret is configured (`secret` is empty), verification is
 * skipped and the raw token is returned as-is. This preserves backward
 * compatibility for localhost-only deployments.
 */

/**
 * Sign a session ID with an HMAC-SHA256 signature.
 *
 * @param sessionId - The raw session ID to sign.
 * @param secret - The server-side secret key. If empty, the session ID
 *                 is returned unchanged (unsigned mode).
 * @returns The signed token: `sessionId.signature`, or just `sessionId`
 *          when `secret` is empty.
 */
export function sign(sessionId: string, secret: string): string {
  if (!secret) {
    return sessionId;
  }
  const sig = createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${sig}`;
}

/**
 * Verify a session token and extract the session ID.
 *
 * Splits the token on the last `.` to separate the session ID from the
 * signature, then uses `timingSafeEqual` to compare the expected HMAC
 * with the provided one (constant-time comparison to prevent timing
 * attacks).
 *
 * @param token - The token to verify (may be `sessionId` or `sessionId.signature`).
 * @param secret - The server-side secret key. If empty, the token is
 *                 returned as-is without verification (unsigned mode).
 * @returns The verified session ID, or `null` if verification fails.
 */
export function verify(token: string, secret: string): string | null {
  if (!secret) {
    // Unsigned mode: no verification, return the token directly
    return token;
  }

  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) {
    // No signature delimiter found
    return null;
  }

  const sessionId = token.substring(0, lastDot);
  const providedSig = token.substring(lastDot + 1);

  if (!sessionId || !providedSig) {
    return null;
  }

  const expectedSig = createHmac("sha256", secret).update(sessionId).digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);

  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  return sessionId;
}
