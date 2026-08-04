import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AttachmentService } from "../../src/services/attachment/AttachmentService.js";
import { FileIntelligenceService } from "../../src/services/parser/FileIntelligenceService.js";
import { FsAttachmentRepository } from "../../src/infrastructure/fs/FsAttachmentRepository.js";
import { ErrorCode } from "../../src/domain/attachment/Result.js";
import type { AppConfig } from "../../src/config/index.js";

let tempDir: string;
let config: AppConfig;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-svc-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  config = {
    storagePath: tempDir,
    maxFileSize: 10 * 1024 * 1024,
    maxBatchSize: 5,
    allowedExtensions: ["txt", "md", "json", "csv", "png", "jpg", "pdf"],
    rateLimit: { windowMs: 60000, max: 100 },
    sessionTtl: 3600,
    shellTimeout: 30000,
    corsOrigins: ["*"],
    httpPort: 3141,
    sessionSecret: "",
  };
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function createService(): AttachmentService {
  const repo = new FsAttachmentRepository(tempDir);
  const fileIntel = new FileIntelligenceService();
  return new AttachmentService(repo, fileIntel, config);
}

describe("AttachmentService", () => {
  describe("upload", () => {
    it("should upload a text file successfully", async () => {
      const service = createService();
      const result = await service.upload("test-session", {
        originalName: "hello.txt",
        content: Buffer.from("Hello, World!"),
      });

      assert.ok(result.ok);
      assert.equal(result.value.attachment.originalName, "hello.txt");
      assert.equal(result.value.attachment.size, 13);
      assert.equal(result.value.attachment.mimeType, "text/plain");
      assert.ok(result.value.attachment.hash);
      assert.ok(result.value.attachment.preview);
    });

    it("should reject empty session ID", async () => {
      const service = createService();
      const result = await service.upload("", {
        originalName: "test.txt",
        content: Buffer.from("test"),
      });

      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.SESSION_NOT_FOUND);
    });

    it("should reject empty filename", async () => {
      const service = createService();
      const result = await service.upload("test-session", {
        originalName: "",
        content: Buffer.from("test"),
      });

      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.INVALID_INPUT);
    });

    it("should reject file exceeding size limit", async () => {
      const smallConfig = { ...config, maxFileSize: 10 };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), smallConfig);

      const result = await service.upload("test-session", {
        originalName: "big.txt",
        content: Buffer.alloc(100, "x"),
      });

      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.FILE_TOO_LARGE);
    });

    it("should reject disallowed extension", async () => {
      const strictConfig = { ...config, allowedExtensions: ["txt", "md"] };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), strictConfig);

      const result = await service.upload("test-session", {
        originalName: "script.exe",
        content: Buffer.from("binary"),
      });

      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.INVALID_EXTENSION);
    });

    it("should reject file without extension when whitelist is configured", async () => {
      const strictConfig = { ...config, allowedExtensions: ["txt", "md"] };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), strictConfig);

      const result = await service.upload("noext-session", {
        originalName: "README",
        content: Buffer.from("no extension here"),
      });

      assert.ok(!result.ok, "Upload of extensionless file should be rejected");
      assert.equal(result.error, ErrorCode.INVALID_EXTENSION);
    });

    it("should reject file with trailing dot when whitelist is configured", async () => {
      const strictConfig = { ...config, allowedExtensions: ["txt", "md"] };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), strictConfig);

      const result = await service.upload("trailing-dot-session", {
        originalName: "file.",
        content: Buffer.from("trailing dot"),
      });

      assert.ok(!result.ok, "Upload of file with trailing dot should be rejected");
      assert.equal(result.error, ErrorCode.INVALID_EXTENSION);
    });

    it("should accept file without extension when whitelist is empty", async () => {
      const noWhitelistConfig = { ...config, allowedExtensions: [] };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), noWhitelistConfig);

      const result = await service.upload("noext-allow-session", {
        originalName: "Makefile",
        content: Buffer.from("all: build"),
      });

      assert.ok(result.ok, "Upload of extensionless file should succeed when no whitelist");
    });

    it("should auto-detect MIME type from content", async () => {
      const service = createService();
      const pdfBuf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

      const result = await service.upload("test-session", {
        originalName: "doc.pdf",
        content: pdfBuf,
      });

      assert.ok(result.ok);
      assert.equal(result.value.attachment.mimeType, "application/pdf");
    });
  });

  describe("uploadBatch", () => {
    it("should upload multiple files", async () => {
      const service = createService();
      const result = await service.uploadBatch("batch-session", [
        { originalName: "file1.txt", content: Buffer.from("content1") },
        { originalName: "file2.txt", content: Buffer.from("content2") },
        { originalName: "file3.md", content: Buffer.from("# Markdown") },
      ]);

      assert.equal(result.uploaded.length, 3);
      assert.equal(result.errors.length, 0);
    });

    it("should report errors for individual file failures", async () => {
      const strictConfig = { ...config, allowedExtensions: ["txt"] };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), strictConfig);

      const result = await service.uploadBatch("batch-err-session", [
        { originalName: "good.txt", content: Buffer.from("ok") },
        { originalName: "bad.exe", content: Buffer.from("bad") },
      ]);

      assert.equal(result.uploaded.length, 1);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].filename, "bad.exe");
      assert.equal(result.errors[0].error, ErrorCode.INVALID_EXTENSION);
    });

    it("should reject batch exceeding max size", async () => {
      const smallConfig = { ...config, maxBatchSize: 2 };
      const repo = new FsAttachmentRepository(tempDir);
      const service = new AttachmentService(repo, new FileIntelligenceService(), smallConfig);

      const result = await service.uploadBatch("batch-limit-session", [
        { originalName: "f1.txt", content: Buffer.from("1") },
        { originalName: "f2.txt", content: Buffer.from("2") },
        { originalName: "f3.txt", content: Buffer.from("3") },
      ]);

      assert.equal(result.uploaded.length, 0);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].error, ErrorCode.INVALID_INPUT);
    });
  });

  describe("findById", () => {
    it("should find an uploaded attachment", async () => {
      const service = createService();
      const uploadResult = await service.upload("find-session", {
        originalName: "findable.txt",
        content: Buffer.from("find me"),
      });
      assert.ok(uploadResult.ok);
      const id = uploadResult.value.attachment.id;

      const found = await service.findById("find-session", id);
      assert.ok(found.ok);
      assert.equal(found.value.originalName, "findable.txt");
    });

    it("should return error for non-existent attachment", async () => {
      const service = createService();
      const result = await service.findById("find-session", "nonexistent-id");
      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.ATTACHMENT_NOT_FOUND);
    });
  });

  describe("readFile", () => {
    it("should read file content", async () => {
      const service = createService();
      const content = Buffer.from("read this content");
      const uploadResult = await service.upload("read-session", {
        originalName: "readable.txt",
        content,
      });
      assert.ok(uploadResult.ok);
      const id = uploadResult.value.attachment.id;

      const readResult = await service.readFile("read-session", id);
      assert.ok(readResult.ok);
      assert.deepEqual(readResult.value.content, content);
    });
  });

  describe("readText", () => {
    it("should read text content with encoding info", async () => {
      const service = createService();
      const text = "Hello, text reader!";
      const uploadResult = await service.upload("text-session", {
        originalName: "text.txt",
        content: Buffer.from(text),
      });
      assert.ok(uploadResult.ok);
      const id = uploadResult.value.attachment.id;

      const textResult = await service.readText("text-session", id);
      assert.ok(textResult.ok);
      assert.equal(textResult.value.text, text);
      assert.ok(textResult.value.encoding);
    });
  });

  describe("delete", () => {
    it("should delete an attachment", async () => {
      const service = createService();
      const uploadResult = await service.upload("del-session", {
        originalName: "deletable.txt",
        content: Buffer.from("delete me"),
      });
      assert.ok(uploadResult.ok);
      const id = uploadResult.value.attachment.id;

      const delResult = await service.delete("del-session", id);
      assert.ok(delResult.ok);
      assert.equal(delResult.value, true);

      // Verify it's gone
      const found = await service.findById("del-session", id);
      assert.ok(!found.ok);
    });

    it("should return error when deleting non-existent attachment", async () => {
      const service = createService();
      const result = await service.delete("del-session", "nonexistent");
      assert.ok(!result.ok);
      assert.equal(result.error, ErrorCode.ATTACHMENT_NOT_FOUND);
    });
  });

  describe("deleteBySession", () => {
    it("should clear all attachments in a session", async () => {
      const service = createService();
      const sessionId = "clear-session";

      await service.upload(sessionId, { originalName: "f1.txt", content: Buffer.from("1") });
      await service.upload(sessionId, { originalName: "f2.txt", content: Buffer.from("2") });

      const result = await service.deleteBySession(sessionId);
      assert.ok(result.ok);
      assert.equal(result.value, 2);

      const list = await service.findBySession(sessionId);
      assert.equal(list.items.length, 0);
    });
  });

  describe("session isolation", () => {
    it("should not allow cross-session access to attachments", async () => {
      const service = createService();
      const uploadResult = await service.upload("iso-session-a", {
        originalName: "iso.txt",
        content: Buffer.from("isolated"),
      });
      assert.ok(uploadResult.ok);
      const id = uploadResult.value.attachment.id;

      // Session B cannot find Session A's attachment
      const crossFind = await service.findById("iso-session-b", id);
      assert.ok(!crossFind.ok);
      assert.equal(crossFind.error, ErrorCode.ATTACHMENT_NOT_FOUND);
    });
  });
});
