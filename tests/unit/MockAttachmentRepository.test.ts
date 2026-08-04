import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockAttachmentRepository } from "../../src/infrastructure/fs/MockAttachmentRepository.js";
import type { AttachmentInfo } from "../../src/domain/attachment/AttachmentInfo.js";

function createTestAttachment(id: string, sessionId: string): AttachmentInfo {
  return {
    id,
    sessionId,
    originalName: `test-${id}.txt`,
    mimeType: "text/plain",
    size: 1024,
    storagePath: `${sessionId}/${id}`,
    uploadedAt: new Date().toISOString(),
  };
}

describe("MockAttachmentRepository", () => {
  it("should save and find an attachment by ID", async () => {
    const repo = new MockAttachmentRepository();
    const att = createTestAttachment("att-1", "session-A");

    const savedId = await repo.save("session-A", att);
    assert.equal(savedId, "att-1");

    const found = await repo.findById("session-A", "att-1");
    assert.ok(found);
    assert.equal(found!.originalName, "test-att-1.txt");
  });

  it("should return null when attachment not found", async () => {
    const repo = new MockAttachmentRepository();
    const found = await repo.findById("session-X", "nonexistent");
    assert.equal(found, null);
  });

  it("should isolate attachments by session", async () => {
    const repo = new MockAttachmentRepository();
    const attA = createTestAttachment("att-A", "session-A");
    const attB = createTestAttachment("att-B", "session-B");

    await repo.save("session-A", attA);
    await repo.save("session-B", attB);

    // Session A cannot see Session B's attachments
    const crossFind = await repo.findById("session-A", "att-B");
    assert.equal(crossFind, null);

    // Session B cannot see Session A's attachments
    const crossFind2 = await repo.findById("session-B", "att-A");
    assert.equal(crossFind2, null);
  });

  it("should paginate results correctly", async () => {
    const repo = new MockAttachmentRepository();
    const sessionId = "session-paginate";

    // Save 25 attachments
    for (let i = 0; i < 25; i++) {
      await repo.save(sessionId, createTestAttachment(`att-${i}`, sessionId));
    }

    // Page 1, limit 10
    const page1 = await repo.findBySession(sessionId, { page: 1, limit: 10 });
    assert.equal(page1.items.length, 10);
    assert.equal(page1.total, 25);
    assert.equal(page1.page, 1);
    assert.equal(page1.totalPages, 3);

    // Page 3, limit 10 (last page has 5 items)
    const page3 = await repo.findBySession(sessionId, { page: 3, limit: 10 });
    assert.equal(page3.items.length, 5);
    assert.equal(page3.totalPages, 3);
  });

  it("should use default pagination when no opts provided", async () => {
    const repo = new MockAttachmentRepository();
    const sessionId = "session-default";

    for (let i = 0; i < 5; i++) {
      await repo.save(sessionId, createTestAttachment(`att-${i}`, sessionId));
    }

    const result = await repo.findBySession(sessionId);
    assert.equal(result.items.length, 5);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 20);
    assert.equal(result.totalPages, 1);
  });

  it("should delete an attachment by ID", async () => {
    const repo = new MockAttachmentRepository();
    const att = createTestAttachment("att-del", "session-del");
    await repo.save("session-del", att);

    const deleted = await repo.delete("session-del", "att-del");
    assert.equal(deleted, true);

    const found = await repo.findById("session-del", "att-del");
    assert.equal(found, null);
  });

  it("should return false when deleting nonexistent attachment", async () => {
    const repo = new MockAttachmentRepository();
    const deleted = await repo.delete("session-X", "nonexistent");
    assert.equal(deleted, false);
  });

  it("should delete all attachments for a session", async () => {
    const repo = new MockAttachmentRepository();
    const sessionId = "session-clear";

    await repo.save(sessionId, createTestAttachment("att-1", sessionId));
    await repo.save(sessionId, createTestAttachment("att-2", sessionId));
    await repo.save(sessionId, createTestAttachment("att-3", sessionId));

    const count = await repo.deleteBySession(sessionId);
    assert.equal(count, 3);

    const remaining = await repo.findBySession(sessionId);
    assert.equal(remaining.total, 0);
  });

  it("should check existence correctly", async () => {
    const repo = new MockAttachmentRepository();
    const att = createTestAttachment("att-exist", "session-exist");
    await repo.save("session-exist", att);

    assert.equal(await repo.exists("session-exist", "att-exist"), true);
    assert.equal(await repo.exists("session-exist", "nonexistent"), false);
    assert.equal(await repo.exists("session-other", "att-exist"), false);
  });

  it("should count attachments per session", async () => {
    const repo = new MockAttachmentRepository();

    await repo.save("session-A", createTestAttachment("att-1", "session-A"));
    await repo.save("session-A", createTestAttachment("att-2", "session-A"));
    await repo.save("session-B", createTestAttachment("att-3", "session-B"));

    assert.equal(await repo.count("session-A"), 2);
    assert.equal(await repo.count("session-B"), 1);
    assert.equal(await repo.count("session-C"), 0);
  });

  it("should reset all data", async () => {
    const repo = new MockAttachmentRepository();
    await repo.save("session-A", createTestAttachment("att-1", "session-A"));
    repo.reset();

    assert.equal(await repo.count("session-A"), 0);
  });
});
