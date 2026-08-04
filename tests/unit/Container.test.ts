import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.js";
import { createServices, createTestServices } from "../../src/di/container.js";
import { MockAttachmentRepository } from "../../src/infrastructure/fs/MockAttachmentRepository.js";

describe("Config - loadConfig", () => {
  it("should load default values when env vars not set", () => {
    // Clear env vars for this test
    const saved: Record<string, string | undefined> = {};
    const keys = [
      "WORD_AI_STORAGE_PATH", "WORD_AI_MAX_FILE_SIZE", "WORD_AI_MAX_BATCH",
      "WORD_AI_ALLOWED_EXT", "WORD_AI_RATE_WINDOW", "WORD_AI_RATE_MAX",
      "WORD_AI_SESSION_TTL", "WORD_AI_SHELL_TIMEOUT", "WORD_AI_CORS_ORIGINS",
      "WORD_AI_HTTP_PORT",
    ];
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    const config = loadConfig();

    assert.equal(config.storagePath, "./data/attachments");
    assert.equal(config.maxFileSize, 50 * 1024 * 1024);
    assert.equal(config.maxBatchSize, 20);
    assert.deepEqual(config.allowedExtensions, ["pdf", "txt", "md", "json", "csv", "docx", "xlsx", "png", "jpg", "gif"]);
    assert.equal(config.rateLimit.windowMs, 60000);
    assert.equal(config.rateLimit.max, 20);
    assert.equal(config.sessionTtl, 7 * 24 * 3600);
    assert.equal(config.shellTimeout, 30000);
    assert.deepEqual(config.corsOrigins, ["http://localhost:*"]);
    assert.equal(config.httpPort, 3141);

    // Restore env vars
    for (const key of keys) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });

  it("should read custom values from environment", () => {
    process.env.WORD_AI_STORAGE_PATH = "/custom/path";
    process.env.WORD_AI_MAX_FILE_SIZE = "1048576";
    process.env.WORD_AI_HTTP_PORT = "8080";

    const config = loadConfig();

    assert.equal(config.storagePath, "/custom/path");
    assert.equal(config.maxFileSize, 1048576);
    assert.equal(config.httpPort, 8080);

    delete process.env.WORD_AI_STORAGE_PATH;
    delete process.env.WORD_AI_MAX_FILE_SIZE;
    delete process.env.WORD_AI_HTTP_PORT;
  });
});

describe("DI Container - createServices", () => {
  it("should create a service container with repository and config", () => {
    const config = loadConfig();
    const container = createServices(config);

    assert.ok(container.repository);
    assert.ok(container.config);
    assert.equal(container.config, config);
    assert.equal(container.repository.constructor.name, "FsAttachmentRepository");
  });

  it("should create test services with custom repository", () => {
    const config = loadConfig();
    const customRepo = new MockAttachmentRepository();
    const container = createTestServices(config, customRepo);

    assert.equal(container.repository, customRepo);
  });

  it("should create test services with default mock repository", () => {
    const config = loadConfig();
    const container = createTestServices(config);

    assert.ok(container.repository);
    assert.equal(container.repository.constructor.name, "MockAttachmentRepository");
  });
});
