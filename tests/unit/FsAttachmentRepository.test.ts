import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { FsAttachmentRepository } from "../../src/infrastructure/fs/FsAttachmentRepository.js";
import type { AttachmentInfo } from "../../src/domain/attachment/AttachmentInfo.js";

let tempDir: string;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function createAttachment(id: string, sessionId: string): AttachmentInfo {
  return {
    id,
    sessionId,
    originalName: `test-${id}.txt`,
    mimeType: "text/plain",
    size: 100,
    storagePath: `${sessionId}/${id}.bin`,
    uploadedAt: new Date().toISOString(),
    hash: "abc123",
    encoding: "utf-8",
    preview: "test content",
  };
}

describe("FsAttachmentRepository", () => {
  describe("save + findById", () => {
    it("should save and retrieve an attachment", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const att = createAttachment("att-1", "session-A");

      const savedId = await repo.save("session-A", att);
      assert.equal(savedId, "att-1");

      const found = await repo.findById("session-A", "att-1");
      assert.ok(found);
      assert.equal(found!.id, "att-1");
      assert.equal(found!.originalName, "test-att-1.txt");
      assert.equal(found!.hash, "abc123");
    });

    it("should return null for non-existent attachment", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const found = await repo.findById("session-X", "nonexistent");
      assert.equal(found, null);
    });
  });

  describe("findBySession", () => {
    it("should list attachments for a session with pagination", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-list-test";

      // Create 5 attachments
      for (let i = 1; i <= 5; i++) {
        const att = createAttachment(`list-att-${i}`, sessionId);
        att.uploadedAt = new Date(Date.now() + i * 1000).toISOString();
        await repo.save(sessionId, att);
      }

      // Page 1 with limit 2
      const page1 = await repo.findBySession(sessionId, { page: 1, limit: 2 });
      assert.equal(page1.items.length, 2);
      assert.equal(page1.total, 5);
      assert.equal(page1.page, 1);
      assert.equal(page1.limit, 2);
      assert.equal(page1.totalPages, 3);

      // Page 3 with limit 2 (last page, 1 item)
      const page3 = await repo.findBySession(sessionId, { page: 3, limit: 2 });
      assert.equal(page3.items.length, 1);
    });

    it("should return empty list for session with no attachments", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const result = await repo.findBySession("empty-session");
      assert.equal(result.items.length, 0);
      assert.equal(result.total, 0);
    });

    it("should sort by upload time descending (newest first)", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-sort-test";

      const att1 = createAttachment("sort-1", sessionId);
      att1.uploadedAt = "2024-01-01T00:00:00.000Z";
      await repo.save(sessionId, att1);

      const att2 = createAttachment("sort-2", sessionId);
      att2.uploadedAt = "2024-06-01T00:00:00.000Z";
      await repo.save(sessionId, att2);

      const result = await repo.findBySession(sessionId);
      assert.equal(result.items[0].id, "sort-2");
      assert.equal(result.items[1].id, "sort-1");
    });
  });

  describe("delete", () => {
    it("should delete an attachment and its file", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-delete-test";

      const att = createAttachment("del-att", sessionId);
      await repo.save(sessionId, att);
      await repo.safeWriteFile(sessionId, "del-att", Buffer.from("test content"));

      const deleted = await repo.delete(sessionId, "del-att");
      assert.equal(deleted, true);

      const found = await repo.findById(sessionId, "del-att");
      assert.equal(found, null);
    });

    it("should return false when deleting non-existent attachment", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const deleted = await repo.delete("session-X", "nonexistent");
      assert.equal(deleted, false);
    });
  });

  describe("deleteBySession", () => {
    it("should delete all attachments for a session", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-clear-test";

      for (let i = 1; i <= 3; i++) {
        await repo.save(sessionId, createAttachment(`clear-${i}`, sessionId));
      }

      const count = await repo.deleteBySession(sessionId);
      assert.equal(count, 3);

      const remaining = await repo.findBySession(sessionId);
      assert.equal(remaining.items.length, 0);
    });

    it("should return 0 for non-existent session", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const count = await repo.deleteBySession("nonexistent-session");
      assert.equal(count, 0);
    });
  });

  describe("exists", () => {
    it("should return true for existing attachment", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-exists-test";
      await repo.save(sessionId, createAttachment("exists-1", sessionId));

      assert.equal(await repo.exists(sessionId, "exists-1"), true);
    });

    it("should return false for non-existent attachment", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      assert.equal(await repo.exists("session-X", "nonexistent"), false);
    });
  });

  describe("count", () => {
    it("should count attachments in a session", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-count-test";

      for (let i = 1; i <= 4; i++) {
        await repo.save(sessionId, createAttachment(`count-${i}`, sessionId));
      }

      const count = await repo.count(sessionId);
      assert.equal(count, 4);
    });

    it("should return 0 for empty session", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      assert.equal(await repo.count("empty-count-session"), 0);
    });
  });

  describe("session isolation", () => {
    it("should not allow cross-session access", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      await repo.save("iso-A", createAttachment("iso-att", "iso-A"));

      // Session B cannot see Session A's attachment
      const crossFound = await repo.findById("iso-B", "iso-att");
      assert.equal(crossFound, null);

      // Session B cannot delete Session A's attachment
      const crossDelete = await repo.delete("iso-B", "iso-att");
      assert.equal(crossDelete, false);
    });
  });

  describe("safeWriteFile + readFile", () => {
    it("should write and read binary file content", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      const sessionId = "session-rw-test";
      const content = Buffer.from("binary file content \x00\x01\x02");

      const filePath = await repo.safeWriteFile(sessionId, "rw-att", content);
      assert.ok(filePath);

      const read = await repo.readFile(sessionId, "rw-att");
      assert.deepEqual(read, content);
    });
  });

  describe("path traversal protection", () => {
    it("should reject invalid session IDs", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      await assert.rejects(() => repo.findById("../../../etc", "att"), /Invalid sessionId/);
    });

    it("should reject invalid attachment IDs", async () => {
      const repo = new FsAttachmentRepository(tempDir);
      await assert.rejects(() => repo.findById("valid-session", "../../etc/passwd"), /Invalid attachmentId/);
    });
  });
});
