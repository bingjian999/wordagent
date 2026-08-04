/**
 * Unit tests for RetentionPolicy.
 *
 * Verifies:
 * - Expired sessions are deleted
 * - Non-expired sessions are preserved
 * - Session age is determined by directory mtime (optimized)
 * - _audit and hidden directories are skipped
 * - Non-existent storage path is handled gracefully
 * - Cleanup statistics are reported correctly
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { RetentionPolicy } from "../../src/services/retention/RetentionPolicy.js";

describe("RetentionPolicy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "retention-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: create a session directory with metadata files.
   * Sets the directory mtime to simulate an old or recent session.
   *
   * @param sessionId - Session ID
   * @param uploadedAt - ISO timestamp for metadata files
   * @param fileCount - Number of attachment files to create
   * @param dirMtimeMs - Optional mtime to set on the directory (defaults to uploadedAt)
   */
  async function createSession(
    sessionId: string,
    uploadedAt: string,
    fileCount: number = 1,
    dirMtimeMs?: number,
  ): Promise<void> {
    const sessionDir = path.join(tempDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    for (let i = 0; i < fileCount; i++) {
      const id = `att-${i}`;
      // Create .bin file
      await fs.writeFile(path.join(sessionDir, `${id}.bin`), `content-${i}`);
      // Create .meta.json file
      const meta = {
        id,
        sessionId,
        originalName: `file-${i}.txt`,
        mimeType: "text/plain",
        size: 10,
        storagePath: `${sessionId}/${id}.bin`,
        uploadedAt,
        hash: "abc123",
      };
      await fs.writeFile(
        path.join(sessionDir, `${id}.meta.json`),
        JSON.stringify(meta),
      );
    }

    // Set directory mtime to simulate the session's age
    // This is necessary because the optimized RetentionPolicy uses
    // directory mtime instead of reading metadata files.
    const mtime = dirMtimeMs ?? new Date(uploadedAt).getTime();
    const mtimeSec = Math.floor(mtime / 1000);
    await fs.utimes(sessionDir, mtimeSec, mtimeSec);
  }

  it("should delete expired sessions", async () => {
    // Create a session with old timestamp (30 days ago)
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await createSession("old-session", oldDate, 2);

    // TTL: 7 days
    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    assert.equal(result.sessionsScanned, 1);
    assert.equal(result.sessionsDeleted, 1);
    assert.equal(result.attachmentsDeleted, 2);
    assert.equal(result.errors.length, 0);
  });

  it("should preserve non-expired sessions", async () => {
    // Create a session with recent timestamp (1 hour ago)
    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString();
    await createSession("recent-session", recentDate, 1);

    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    assert.equal(result.sessionsScanned, 1);
    assert.equal(result.sessionsDeleted, 0);
    assert.equal(result.attachmentsDeleted, 0);

    // Verify session directory still exists
    const stat = await fs.stat(path.join(tempDir, "recent-session"));
    assert.ok(stat.isDirectory());
  });

  it("should use directory mtime for session age", async () => {
    // Create session with old metadata but recent directory mtime
    const sessionDir = path.join(tempDir, "mixed-session");
    await fs.mkdir(sessionDir, { recursive: true });

    // Old metadata (30 days ago) — but this is no longer read
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await fs.writeFile(path.join(sessionDir, "old.bin"), "old");
    await fs.writeFile(
      path.join(sessionDir, "old.meta.json"),
      JSON.stringify({ id: "old", uploadedAt: oldDate }),
    );

    // Set directory mtime to recent (1 hour ago)
    const recentMs = Date.now() - 3600 * 1000;
    const recentSec = Math.floor(recentMs / 1000);
    await fs.utimes(sessionDir, recentSec, recentSec);

    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    // Session should NOT be deleted because directory mtime is recent
    assert.equal(result.sessionsDeleted, 0);
    assert.equal(result.attachmentsDeleted, 0);
  });

  it("should skip _audit and hidden directories", async () => {
    // Create audit directory (should be skipped)
    await fs.mkdir(path.join(tempDir, "_audit"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "_audit", "audit.log"), "[]");

    // Create hidden directory (should be skipped)
    await fs.mkdir(path.join(tempDir, ".hidden"), { recursive: true });

    // Create an expired session
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await createSession("expired", oldDate, 1);

    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    // Only "expired" should be counted as a session
    assert.equal(result.sessionsScanned, 1);
    assert.equal(result.sessionsDeleted, 1);

    // _audit should still exist
    const stat = await fs.stat(path.join(tempDir, "_audit"));
    assert.ok(stat.isDirectory());
  });

  it("should handle non-existent storage path gracefully", async () => {
    const policy = new RetentionPolicy(
      path.join(tempDir, "does-not-exist"),
      7 * 24 * 3600,
    );
    const result = await policy.run();

    assert.equal(result.sessionsScanned, 0);
    assert.equal(result.sessionsDeleted, 0);
    assert.equal(result.errors.length, 0);
  });

  it("should handle mixed expired and non-expired sessions", async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString();

    await createSession("old-1", oldDate, 3);
    await createSession("old-2", oldDate, 1);
    await createSession("recent-1", recentDate, 2);
    await createSession("recent-2", recentDate, 1);

    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    assert.equal(result.sessionsScanned, 4);
    assert.equal(result.sessionsDeleted, 2);
    assert.equal(result.attachmentsDeleted, 4); // 3 + 1 from old sessions
  });

  it("should report duration", async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await createSession("old", oldDate, 1);

    const policy = new RetentionPolicy(tempDir, 7 * 24 * 3600);
    const result = await policy.run();

    assert.ok(result.durationMs >= 0);
    assert.ok(result.durationMs < 5000); // Should be fast
  });
});
