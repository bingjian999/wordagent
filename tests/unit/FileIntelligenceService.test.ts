import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileIntelligenceService } from "../../src/services/parser/FileIntelligenceService.js";

describe("FileIntelligenceService", () => {
  const service = new FileIntelligenceService();

  describe("getExtension", () => {
    it("should extract lowercase extension", () => {
      assert.equal(service.getExtension("report.PDF"), "pdf");
      assert.equal(service.getExtension("data.JSON"), "json");
      assert.equal(service.getExtension("file.txt"), "txt");
    });

    it("should return empty string for no extension", () => {
      assert.equal(service.getExtension("README"), "");
      assert.equal(service.getExtension("file."), "");
    });
  });

  describe("calculateHash", () => {
    it("should produce consistent SHA-256 hashes", () => {
      const buf = Buffer.from("hello world");
      const hash1 = service.calculateHash(buf);
      const hash2 = service.calculateHash(buf);
      assert.equal(hash1, hash2);
      assert.equal(hash1, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    });

    it("should produce different hashes for different content", () => {
      const h1 = service.calculateHash(Buffer.from("hello"));
      const h2 = service.calculateHash(Buffer.from("world"));
      assert.notEqual(h1, h2);
    });
  });

  describe("detectIsText", () => {
    it("should detect text files by extension", () => {
      assert.equal(service.detectIsText(Buffer.from("hello"), "txt"), true);
      assert.equal(service.detectIsText(Buffer.from("hello"), "md"), true);
      assert.equal(service.detectIsText(Buffer.from("hello"), "json"), true);
    });

    it("should detect binary files by null bytes", () => {
      const binaryBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      assert.equal(service.detectIsText(binaryBuf, "bin"), false);
    });

    it("should treat empty files as text", () => {
      assert.equal(service.detectIsText(Buffer.alloc(0), ""), true);
    });

    it("should detect text by printable character ratio", () => {
      const textBuf = Buffer.from("This is a plain text file with lots of printable characters.\n");
      assert.equal(service.detectIsText(textBuf, ""), true);
    });
  });

  describe("detectEncoding", () => {
    it("should detect UTF-8 BOM", () => {
      const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      assert.equal(service.detectEncoding(buf), "utf-8-bom");
    });

    it("should detect UTF-16LE BOM", () => {
      const buf = Buffer.from([0xff, 0xfe, 0x68, 0x00]);
      assert.equal(service.detectEncoding(buf), "utf-16le");
    });

    it("should detect pure ASCII", () => {
      const buf = Buffer.from("Hello, World!");
      assert.equal(service.detectEncoding(buf), "ascii");
    });

    it("should return utf-8 for empty buffer", () => {
      assert.equal(service.detectEncoding(Buffer.alloc(0)), "utf-8");
    });
  });

  describe("detectMime", () => {
    it("should detect PDF by magic bytes", () => {
      const pdfBuf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      assert.equal(service.detectMime(pdfBuf, "pdf"), "application/pdf");
    });

    it("should detect PNG by magic bytes", () => {
      const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.equal(service.detectMime(pngBuf, "png"), "image/png");
    });

    it("should detect JPEG by magic bytes", () => {
      const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      assert.equal(service.detectMime(jpgBuf, "jpg"), "image/jpeg");
    });

    it("should fall back to extension mapping", () => {
      assert.equal(service.detectMime(Buffer.alloc(0), "json"), "application/json");
      assert.equal(service.detectMime(Buffer.alloc(0), "md"), "text/markdown");
      assert.equal(service.detectMime(Buffer.alloc(0), "txt"), "text/plain");
    });

    it("should return octet-stream for unknown types", () => {
      assert.equal(service.detectMime(Buffer.alloc(0), "xyz"), "application/octet-stream");
    });
  });

  describe("generatePreview", () => {
    it("should generate preview for text content", () => {
      const buf = Buffer.from("Line 1\nLine 2\nLine 3");
      const preview = service.generatePreview(buf);
      assert.ok(preview);
      assert.ok(preview!.includes("Line 1"));
    });

    it("should truncate long content", () => {
      const longText = "A".repeat(3000);
      const buf = Buffer.from(longText);
      const preview = service.generatePreview(buf);
      assert.ok(preview);
      assert.ok(preview!.length <= 500);
      assert.ok(preview!.endsWith("..."));
    });

    it("should return empty string for empty buffer", () => {
      const preview = service.generatePreview(Buffer.alloc(0));
      assert.equal(preview, "");
    });
  });

  describe("analyze (integration)", () => {
    it("should return complete analysis for a text file", () => {
      const buf = Buffer.from("# Hello World\nThis is a test.");
      const result = service.analyze(buf, "test.md");

      assert.ok(result.hash);
      assert.equal(result.isText, true);
      assert.equal(result.encoding, "ascii");
      assert.equal(result.mimeType, "text/markdown");
      assert.ok(result.preview);
      assert.ok(result.preview!.includes("Hello World"));
    });

    it("should return complete analysis for a binary file", () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const result = service.analyze(buf, "image.png");

      assert.ok(result.hash);
      assert.equal(result.isText, false);
      assert.equal(result.encoding, "binary");
      assert.equal(result.mimeType, "image/png");
      assert.equal(result.preview, null);
    });
  });
});
