/**
 * Unit tests for AuditLogger.
 *
 * Verifies:
 * - Log entries are written as JSONL
 * - delete, clear, and upload actions are logged correctly
 * - readAll returns all entries
 * - Logger never throws (best-effort)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AuditLogger } from "../../src/services/audit/AuditLogger.js";

describe("AuditLogger", () => {
  let tempDir: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    logger = new AuditLogger(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create log directory on first use", async () => {
    await logger.logDelete("session-1", "att-1", "test.txt");
    const stat = await fs.stat(path.join(tempDir, "_audit", "audit.log"));
    assert.ok(stat.isFile());
  });

  it("should log delete operations", async () => {
    await logger.logDelete("session-1", "att-1", "report.pdf");

    const entries = await logger.readAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "delete");
    assert.equal(entries[0].sessionId, "session-1");
    assert.equal(entries[0].targetId, "att-1");
    assert.equal(entries[0].targetName, "report.pdf");
    assert.ok(entries[0].timestamp);
  });

  it("should log clear operations with count", async () => {
    await logger.logClear("session-1", 5);

    const entries = await logger.readAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "clear");
    assert.equal(entries[0].sessionId, "session-1");
    assert.equal(entries[0].details?.deletedCount, 5);
  });

  it("should log upload operations with size", async () => {
    await logger.logUpload("session-1", "att-1", "data.csv", 2048);

    const entries = await logger.readAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "upload");
    assert.equal(entries[0].targetName, "data.csv");
    assert.equal(entries[0].details?.size, 2048);
  });

  it("should append multiple entries in order", async () => {
    await logger.logUpload("s1", "a1", "f1.txt", 100);
    await logger.logDelete("s1", "a1", "f1.txt");
    await logger.logClear("s1", 1);

    const entries = await logger.readAll();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].action, "upload");
    assert.equal(entries[1].action, "delete");
    assert.equal(entries[2].action, "clear");
  });

  it("should write valid JSONL format", async () => {
    await logger.logDelete("s1", "a1", "test.txt");
    await logger.logClear("s1", 1);

    const raw = await fs.readFile(path.join(tempDir, "_audit", "audit.log"), "utf-8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 2);
    // Each line must be valid JSON
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok(obj.timestamp);
      assert.ok(obj.action);
      assert.ok(obj.sessionId);
    }
  });

  it("should return empty array when no log file exists", async () => {
    const entries = await logger.readAll();
    assert.deepEqual(entries, []);
  });

  it("should never throw on write errors", async () => {
    // Point to a path that can't be created (under a file)
    const badLogger = new AuditLogger(path.join(tempDir, "not-a-dir.txt"));
    await fs.writeFile(path.join(tempDir, "not-a-dir.txt"), "blocker");

    // Should not throw
    await badLogger.logDelete("s1", "a1", "test.txt");
    await badLogger.logClear("s1", 1);
    await badLogger.logUpload("s1", "a1", "test.txt", 100);
  });
});
