import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sign, verify } from "../../src/auth/SessionToken.js";

describe("SessionToken", () => {
  describe("sign", () => {
    it("should produce sessionId.signature format when secret is provided", () => {
      const token = sign("session-123", "my-secret-key");
      assert.ok(token.includes("."), "Token should contain a dot delimiter");
      const parts = token.split(".");
      assert.equal(parts[0], "session-123", "First part should be the session ID");
      assert.ok(parts[1].length > 0, "Second part should be a non-empty signature");
    });

    it("should return sessionId unchanged when secret is empty", () => {
      const token = sign("session-123", "");
      assert.equal(token, "session-123", "Token should be the raw session ID when secret is empty");
    });

    it("should produce different signatures for different secrets", () => {
      const token1 = sign("session-123", "secret-a");
      const token2 = sign("session-123", "secret-b");
      assert.notEqual(token1, token2, "Different secrets should produce different tokens");
    });

    it("should produce different signatures for different session IDs", () => {
      const token1 = sign("session-a", "my-secret");
      const token2 = sign("session-b", "my-secret");
      assert.notEqual(token1, token2, "Different session IDs should produce different tokens");
    });
  });

  describe("verify", () => {
    it("should return sessionId when signature is valid", () => {
      const token = sign("session-123", "my-secret-key");
      const result = verify(token, "my-secret-key");
      assert.equal(result, "session-123", "Should return the verified session ID");
    });

    it("should return null when signature is tampered", () => {
      const token = sign("session-123", "my-secret-key");
      // Tamper with the signature part
      const lastDot = token.lastIndexOf(".");
      const tampered = token.substring(0, lastDot + 1) + "tamperedSignature";
      const result = verify(tampered, "my-secret-key");
      assert.equal(result, null, "Should return null for tampered signature");
    });

    it("should return null when sessionId is tampered", () => {
      const token = sign("session-123", "my-secret-key");
      // Replace the sessionId part but keep the original signature
      const lastDot = token.lastIndexOf(".");
      const originalSig = token.substring(lastDot + 1);
      const tampered = `session-456.${originalSig}`;
      const result = verify(tampered, "my-secret-key");
      assert.equal(result, null, "Should return null when sessionId doesn't match signature");
    });

    it("should return null when wrong secret is used", () => {
      const token = sign("session-123", "correct-secret");
      const result = verify(token, "wrong-secret");
      assert.equal(result, null, "Should return null when secret doesn't match");
    });

    it("should return token as-is when secret is empty (unsigned mode)", () => {
      const result = verify("session-123", "");
      assert.equal(result, "session-123", "Should return the token without verification");
    });

    it("should return null when token has no dot delimiter and secret is set", () => {
      const result = verify("sessionWithoutDot", "my-secret");
      assert.equal(result, null, "Should return null when no signature is present");
    });

    it("should return null when sessionId part is empty", () => {
      // Token starts with a dot, so sessionId is empty
      const result = verify(".someSignature", "my-secret");
      assert.equal(result, null, "Should return null for empty sessionId");
    });

    it("should return null when signature part is empty", () => {
      const result = verify("session-123.", "my-secret");
      assert.equal(result, null, "Should return null for empty signature");
    });

    it("should handle session IDs that contain dots", () => {
      // A session ID like "abc.def" should be handled correctly
      // The verify function splits on the LAST dot
      const token = sign("abc.def", "my-secret");
      const result = verify(token, "my-secret");
      assert.equal(result, "abc.def", "Should correctly handle session IDs with dots");
    });
  });

  describe("round-trip", () => {
    it("should verify a token produced by sign", () => {
      const sessionId = "test-session-id-abc123";
      const secret = "round-trip-secret";
      const token = sign(sessionId, secret);
      const verified = verify(token, secret);
      assert.equal(verified, sessionId, "Round-trip sign -> verify should return original ID");
    });

    it("should handle empty session ID in unsigned mode", () => {
      // In unsigned mode, even empty strings pass through
      // (the middleware layer handles the empty check separately)
      const result = verify("some-token", "");
      assert.equal(result, "some-token", "Unsigned mode should pass through any token");
    });
  });
});
