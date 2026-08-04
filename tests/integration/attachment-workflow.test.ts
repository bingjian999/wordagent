import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createServices } from "../../src/di/container.js";
import { ErrorCode } from "../../src/domain/attachment/Result.js";
import type { AppConfig } from "../../src/config/index.js";
import type { ServiceContainer } from "../../src/di/container.js";

let tempDir: string;
let services: ServiceContainer;
let testConfig: AppConfig;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-integration-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Override config to use temp directory
  testConfig = {
    storagePath: tempDir,
    maxFileSize: 50 * 1024 * 1024,
    maxBatchSize: 20,
    allowedExtensions: ["txt", "md", "json", "csv", "png", "jpg", "pdf", "docx", "xlsx"],
    rateLimit: { windowMs: 60000, max: 1000 },
    sessionTtl: 3600,
    shellTimeout: 30000,
    corsOrigins: ["*"],
    httpPort: 3141,
  };

  services = createServices(testConfig);
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Attachment Full Workflow Integration", () => {
  const sessionId = "integration-test-session";
  let attachmentId: string;

  it("Step 1: Upload a text file", async () => {
    const result = await services.attachmentService.upload(sessionId, {
      originalName: "integration-test.txt",
      content: Buffer.from("This is integration test content.\nLine 2.\nLine 3."),
    });

    assert.ok(result.ok, "Upload should succeed");
    assert.equal(result.value.attachment.originalName, "integration-test.txt");
    assert.ok(result.value.attachment.id, "Should have an ID");
    assert.ok(result.value.attachment.hash, "Should have a hash");
    assert.ok(result.value.attachment.preview, "Should have a preview");

    attachmentId = result.value.attachment.id;
  });

  it("Step 2: Upload additional files", async () => {
    const results = await Promise.all([
      services.attachmentService.upload(sessionId, {
        originalName: "data.json",
        content: Buffer.from('{"key": "value", "num": 42}'),
      }),
      services.attachmentService.upload(sessionId, {
        originalName: "notes.md",
        content: Buffer.from("# Meeting Notes\n\nImportant discussion items."),
      }),
    ]);

    assert.ok(results[0].ok);
    assert.ok(results[1].ok);
  });

  it("Step 3: List attachments and verify count", async () => {
    const result = await services.attachmentService.findBySession(sessionId, { page: 1, limit: 20 });

    assert.equal(result.total, 3, "Should have 3 attachments");
    assert.equal(result.items.length, 3);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 20);
    assert.equal(result.totalPages, 1);
  });

  it("Step 4: Get info for a specific attachment", async () => {
    const result = await services.attachmentService.findById(sessionId, attachmentId);

    assert.ok(result.ok);
    assert.equal(result.value.id, attachmentId);
    assert.equal(result.value.originalName, "integration-test.txt");
    assert.equal(result.value.sessionId, sessionId);
    assert.ok(result.value.size > 0);
  });

  it("Step 5: Read text content of the attachment", async () => {
    const result = await services.attachmentService.readText(sessionId, attachmentId);

    assert.ok(result.ok);
    assert.ok(result.value.text.includes("integration test content"));
    assert.ok(result.value.text.includes("Line 2"));
    assert.ok(result.value.encoding);
  });

  it("Step 6: Read raw file content (download)", async () => {
    const result = await services.attachmentService.readFile(sessionId, attachmentId);

    assert.ok(result.ok);
    assert.deepEqual(
      result.value.content,
      Buffer.from("This is integration test content.\nLine 2.\nLine 3."),
    );
    assert.equal(result.value.attachment.id, attachmentId);
  });

  it("Step 7: Verify session isolation (other session cannot see attachments)", async () => {
    const otherSession = "other-session";
    const result = await services.attachmentService.findById(otherSession, attachmentId);

    assert.ok(!result.ok);
    assert.equal(result.error, ErrorCode.ATTACHMENT_NOT_FOUND);

    const list = await services.attachmentService.findBySession(otherSession);
    assert.equal(list.total, 0);
  });

  it("Step 8: Delete a single attachment", async () => {
    const result = await services.attachmentService.delete(sessionId, attachmentId);

    assert.ok(result.ok);
    assert.equal(result.value, true);

    // Verify it's gone
    const found = await services.attachmentService.findById(sessionId, attachmentId);
    assert.ok(!found.ok);
  });

  it("Step 9: Verify remaining count after deletion", async () => {
    const result = await services.attachmentService.findBySession(sessionId);

    assert.equal(result.total, 2, "Should have 2 remaining attachments");
  });

  it("Step 10: Clear all attachments", async () => {
    const result = await services.attachmentService.deleteBySession(sessionId);

    assert.ok(result.ok);
    assert.equal(result.value, 2, "Should have deleted 2 attachments");

    const list = await services.attachmentService.findBySession(sessionId);
    assert.equal(list.total, 0, "Session should be empty");
  });
});

describe("Batch Upload Integration", () => {
  const sessionId = "batch-integration-session";

  it("should upload multiple files and list them", async () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      originalName: `batch-file-${i + 1}.txt`,
      content: Buffer.from(`Content of file ${i + 1}`),
    }));

    const result = await services.attachmentService.uploadBatch(sessionId, inputs);

    assert.equal(result.uploaded.length, 5);
    assert.equal(result.errors.length, 0);

    const list = await services.attachmentService.findBySession(sessionId);
    assert.equal(list.total, 5);
  });

  it("should handle mixed success/failure in batch", async () => {
    const inputs = [
      { originalName: "good1.txt", content: Buffer.from("good") },
      { originalName: "good2.md", content: Buffer.from("# good") },
      { originalName: "bad.exe", content: Buffer.from("bad") }, // Not in allowed extensions
    ];

    const result = await services.attachmentService.uploadBatch(sessionId, inputs);

    assert.equal(result.uploaded.length, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].filename, "bad.exe");
  });

  it("should clean up batch session", async () => {
    const result = await services.attachmentService.deleteBySession(sessionId);
    assert.ok(result.ok);
    assert.ok(result.value >= 7, "Should have deleted all files from both batches");
  });
});

describe("Pagination Integration", () => {
  const sessionId = "pagination-integration-session";

  it("should paginate through multiple attachments", async () => {
    // Upload 10 files
    for (let i = 1; i <= 10; i++) {
      await services.attachmentService.upload(sessionId, {
        originalName: `page-file-${i}.txt`,
        content: Buffer.from(`content ${i}`),
      });
    }

    // Page 1, limit 3
    const page1 = await services.attachmentService.findBySession(sessionId, { page: 1, limit: 3 });
    assert.equal(page1.items.length, 3);
    assert.equal(page1.total, 10);
    assert.equal(page1.totalPages, 4);

    // Page 4, limit 3 (last page, 1 item)
    const page4 = await services.attachmentService.findBySession(sessionId, { page: 4, limit: 3 });
    assert.equal(page4.items.length, 1);

    // Page 5 (out of range)
    const page5 = await services.attachmentService.findBySession(sessionId, { page: 5, limit: 3 });
    assert.equal(page5.items.length, 0);
    assert.equal(page5.total, 10);

    // Cleanup
    await services.attachmentService.deleteBySession(sessionId);
  });
});
