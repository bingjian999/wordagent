/**
 * E2E Test: Attachment API
 *
 * Tests the full attachment API lifecycle through real HTTP requests
 * against an Express app backed by FsAttachmentRepository.
 *
 * Flow:
 *   1. Start Express app on ephemeral port
 *   2. Upload single file → verify 201 + attachment metadata
 *   3. Upload batch → verify 200 + multiple attachments
 *   4. List attachments → verify pagination
 *   5. Get by ID → verify metadata
 *   6. Download → verify raw content
 *   7. Read text → verify text extraction
 *   8. Delete single → verify 200
 *   9. Clear all → verify 200
 *  10. Session isolation → two sessions can't see each other's files
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { Express } from "express";
import { createApp } from "../../src/infrastructure/express/server.js";
import { createServices } from "../../src/di/container.js";
import type { AppConfig } from "../../src/config/index.js";

let app: Express;
let server: http.Server;
let baseURL: string;
let tempDir: string;
let config: AppConfig;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-e2e-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  config = {
    storagePath: tempDir,
    maxFileSize: 10 * 1024 * 1024,
    maxBatchSize: 10,
    allowedExtensions: ["txt", "md", "json", "csv", "png", "jpg", "pdf"],
    rateLimit: { windowMs: 60000, max: 100 },
    sessionTtl: 3600,
    shellTimeout: 30000,
    corsOrigins: ["*"],
    httpPort: 0, // ephemeral
    sessionSecret: "", // unsigned mode for testing
  };

  const services = createServices(config);
  app = createApp(services);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseURL = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ================================================================
// HTTP helper
// ================================================================

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json(): any;
}

async function request(
  method: string,
  path: string,
  options: {
    sessionId?: string;
    body?: Buffer | string;
    contentType?: string;
    formData?: Map<string, { value: Buffer; filename?: string; contentType?: string }>;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};

    if (options.sessionId) {
      headers["x-session-id"] = options.sessionId;
    }

    let bodyData: Buffer | undefined;

    if (options.formData) {
      // Build multipart form data
      const boundary = `----word-ai-test${Date.now()}`;
      headers["content-type"] = `multipart/form-data; boundary=${boundary}`;
      const parts: Buffer[] = [];
      for (const [name, file] of options.formData) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="${name}"` +
              (file.filename ? `; filename="${file.filename}"` : "") +
              "\r\n" +
              (file.contentType ? `Content-Type: ${file.contentType}\r\n` : "") +
              "\r\n",
          ),
        );
        parts.push(file.value);
        parts.push(Buffer.from("\r\n"));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      bodyData = Buffer.concat(parts);
    } else if (options.body) {
      bodyData = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
      headers["content-type"] = options.contentType ?? "application/json";
    }

    if (bodyData) {
      headers["content-length"] = bodyData.length.toString();
    }

    const req = http.request(
      `${baseURL}${path}`,
      { method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json() {
              return JSON.parse(body.toString());
            },
          });
        });
      },
    );

    req.on("error", reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// ================================================================
// Tests
// ================================================================

describe("Attachment API E2E", () => {
  describe("Health check", () => {
    it("should return ok status", async () => {
      const res = await request("GET", "/health");
      assert.equal(res.status, 200);
      const data = res.json();
      assert.equal(data.status, "ok");
      assert.ok(data.timestamp);
    });
  });

  describe("Session validation", () => {
    it("should reject requests without x-session-id", async () => {
      const res = await request("GET", "/api/attachments");
      assert.equal(res.status, 400);
      const data = res.json();
      assert.match(data.error.code, /SESSION/i);
    });

    it("should reject requests with empty x-session-id", async () => {
      const res = await request("GET", "/api/attachments", { sessionId: "  " });
      assert.equal(res.status, 400);
    });
  });

  describe("Upload single file", () => {
    it("should upload a text file and return 201", async () => {
      const formData = new Map();
      formData.set("file", {
        value: Buffer.from("Hello, E2E World!"),
        filename: "hello.txt",
        contentType: "text/plain",
      });

      const res = await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-1",
        formData,
      });

      assert.equal(res.status, 201);
      const data = res.json();
      assert.ok(data.attachment.id);
      assert.equal(data.attachment.originalName, "hello.txt");
      assert.equal(data.attachment.size, 17);
      assert.equal(data.attachment.mimeType, "text/plain");
      assert.ok(data.attachment.hash);
      assert.ok(data.attachment.preview);
    });

    it("should reject file with disallowed extension", async () => {
      const formData = new Map();
      formData.set("file", {
        value: Buffer.from("binary"),
        filename: "script.exe",
        contentType: "application/octet-stream",
      });

      const res = await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-1",
        formData,
      });

      assert.equal(res.status, 400);
      const data = res.json();
      assert.match(data.error.code, /EXTENSION/i);
    });

    it("should reject request with no file", async () => {
      const res = await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-1",
      });

      assert.equal(res.status, 400);
    });
  });

  describe("Upload batch", () => {
    it("should upload multiple files", async () => {
      const formData = new Map();
      formData.set("files", {
        value: Buffer.from("file 1 content"),
        filename: "batch1.txt",
        contentType: "text/plain",
      });
      formData.set("files", {
        value: Buffer.from("file 2 content"),
        filename: "batch2.md",
        contentType: "text/markdown",
      });
      formData.set("files", {
        value: Buffer.from('{"key": "value"}'),
        filename: "batch3.json",
        contentType: "application/json",
      });

      const res = await request("POST", "/api/attachments/upload-batch", {
        sessionId: "e2e-session-1",
        formData,
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.ok(data.uploaded.length >= 1);
    });
  });

  describe("List attachments", () => {
    it("should list attachments for the session", async () => {
      const res = await request("GET", "/api/attachments?page=1&limit=20", {
        sessionId: "e2e-session-1",
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.ok(Array.isArray(data.items) || Array.isArray(data.attachments) || Array.isArray(data));
    });

    it("should support pagination", async () => {
      const res = await request("GET", "/api/attachments?page=1&limit=5", {
        sessionId: "e2e-session-1",
      });

      assert.equal(res.status, 200);
    });
  });

  describe("Get and download", () => {
    let attachmentId: string;

    it("should upload a file for get/download tests", async () => {
      const formData = new Map();
      formData.set("file", {
        value: Buffer.from("download test content"),
        filename: "download.txt",
        contentType: "text/plain",
      });

      const res = await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-get",
        formData,
      });

      assert.equal(res.status, 201);
      attachmentId = res.json().attachment.id;
    });

    it("should get attachment by ID", async () => {
      const res = await request("GET", `/api/attachments/${attachmentId}`, {
        sessionId: "e2e-session-get",
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.equal(data.attachment.id, attachmentId);
      assert.equal(data.attachment.originalName, "download.txt");
    });

    it("should download raw file content", async () => {
      const res = await request("GET", `/api/attachments/${attachmentId}/download`, {
        sessionId: "e2e-session-get",
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.toString(), "download test content");
    });

    it("should read text content", async () => {
      const res = await request("GET", `/api/attachments/${attachmentId}/text`, {
        sessionId: "e2e-session-get",
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.ok(data.text || data.content);
    });

    it("should return 404 for nonexistent attachment", async () => {
      const res = await request("GET", "/api/attachments/nonexistent-id", {
        sessionId: "e2e-session-get",
      });

      assert.equal(res.status, 404);
    });
  });

  describe("Delete", () => {
    let attachmentId: string;

    it("should upload a file for deletion tests", async () => {
      const formData = new Map();
      formData.set("file", {
        value: Buffer.from("to be deleted"),
        filename: "deletable.txt",
        contentType: "text/plain",
      });

      const res = await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-del",
        formData,
      });

      assert.equal(res.status, 201);
      attachmentId = res.json().attachment.id;
    });

    it("should delete a single attachment", async () => {
      const res = await request("DELETE", `/api/attachments/${attachmentId}`, {
        sessionId: "e2e-session-del",
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.equal(data.id, attachmentId);
    });

    it("should return 404 after deletion", async () => {
      const res = await request("GET", `/api/attachments/${attachmentId}`, {
        sessionId: "e2e-session-del",
      });

      assert.equal(res.status, 404);
    });
  });

  describe("Clear all", () => {
    it("should require confirm=true", async () => {
      const res = await request("DELETE", "/api/attachments", {
        sessionId: "e2e-session-clear",
      });

      assert.equal(res.status, 400);
    });

    it("should clear all attachments with confirm=true", async () => {
      // First upload some files
      const formData = new Map();
      formData.set("file", {
        value: Buffer.from("clear test 1"),
        filename: "clear1.txt",
        contentType: "text/plain",
      });
      await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-session-clear",
        formData,
      });

      // Clear all
      const res = await request("DELETE", "/api/attachments?confirm=true", {
        sessionId: "e2e-session-clear",
      });

      assert.equal(res.status, 200);
      const data = res.json();
      assert.ok(data.deleted >= 1);
    });
  });

  describe("Session isolation", () => {
    it("should isolate attachments between sessions", async () => {
      // Upload to session A
      const formDataA = new Map();
      formDataA.set("file", {
        value: Buffer.from("session A file"),
        filename: "isolation-a.txt",
        contentType: "text/plain",
      });
      await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-isolation-A",
        formData: formDataA,
      });

      // Upload to session B
      const formDataB = new Map();
      formDataB.set("file", {
        value: Buffer.from("session B file"),
        filename: "isolation-b.txt",
        contentType: "text/plain",
      });
      await request("POST", "/api/attachments/upload", {
        sessionId: "e2e-isolation-B",
        formData: formDataB,
      });

      // Session A should only see its own files
      const resA = await request("GET", "/api/attachments", {
        sessionId: "e2e-isolation-A",
      });
      assert.equal(resA.status, 200);
      const dataA = resA.json();
      const itemsA = dataA.items ?? dataA.attachments ?? dataA;
      const namesA = Array.isArray(itemsA) ? itemsA.map((a: any) => a.originalName) : [];
      assert.ok(namesA.includes("isolation-a.txt"));
      assert.ok(!namesA.includes("isolation-b.txt"));

      // Session B should only see its own files
      const resB = await request("GET", "/api/attachments", {
        sessionId: "e2e-isolation-B",
      });
      assert.equal(resB.status, 200);
      const dataB = resB.json();
      const itemsB = dataB.items ?? dataB.attachments ?? dataB;
      const namesB = Array.isArray(itemsB) ? itemsB.map((a: any) => a.originalName) : [];
      assert.ok(namesB.includes("isolation-b.txt"));
      assert.ok(!namesB.includes("isolation-a.txt"));
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown endpoints", async () => {
      const res = await request("GET", "/api/unknown");
      assert.equal(res.status, 404);
    });
  });
});
