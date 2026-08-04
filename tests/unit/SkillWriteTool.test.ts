import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SkillWriteTool } from "../../src/tools/SkillWriteTool.js";

let sandboxDir: string;
let tool: SkillWriteTool;

before(async () => {
  sandboxDir = path.join(os.tmpdir(), `skillwrite-test-${Date.now()}-${process.pid}`);
  await fs.mkdir(sandboxDir, { recursive: true });
  tool = new SkillWriteTool(sandboxDir);
});

after(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true });
});

// Helper to read a file inside the sandbox
async function readFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(sandboxDir, relPath), "utf8");
}

describe("SkillWriteTool", () => {
  // ----------------------------------------------------------------
  // write operation
  // ----------------------------------------------------------------
  describe("write operation", () => {
    it("should write a file inside the sandbox successfully", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "skill.md",
        content: "# My Skill\n\nA custom skill definition.\n",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "write");
      assert.ok(result.bytesWritten! > 0);
      assert.equal(
        await readFile("skill.md"),
        "# My Skill\n\nA custom skill definition.\n",
      );
    });

    it("should write to a subdirectory and auto-create directories", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "my-skill/SKILL.md",
        content: "# Nested Skill\n",
      });
      assert.equal(result.success, true);
      assert.equal(await readFile("my-skill/SKILL.md"), "# Nested Skill\n");
    });
  });

  // ----------------------------------------------------------------
  // append operation
  // ----------------------------------------------------------------
  describe("append operation", () => {
    it("should append content to an existing file in the sandbox", async () => {
      await tool.edit({
        operation: "write",
        path: "append-target.md",
        content: "first line\n",
      });
      const result = await tool.edit({
        operation: "append",
        path: "append-target.md",
        content: "second line\n",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "append");
      assert.equal(await readFile("append-target.md"), "first line\nsecond line\n");
    });
  });

  // ----------------------------------------------------------------
  // replace_lines operation
  // ----------------------------------------------------------------
  describe("replace_lines operation", () => {
    it("should replace lines in a sandbox file", async () => {
      await tool.edit({
        operation: "write",
        path: "lines.txt",
        content: "line1\nline2\nline3\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "lines.txt",
        startLine: 2,
        endLine: 2,
        content: "REPLACED",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "replace_lines");
      assert.equal(result.replacements, 1);
      assert.equal(await readFile("lines.txt"), "line1\nREPLACED\nline3\n");
    });
  });

  // ----------------------------------------------------------------
  // Security tests
  // ----------------------------------------------------------------
  describe("security", () => {
    it("should reject absolute paths", async () => {
      const absPath = path.resolve(sandboxDir, "evil.txt");
      const result = await tool.edit({
        operation: "write",
        path: absPath,
        content: "malicious",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /Absolute/);
    });

    it("should reject path traversal attempts", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "../../etc/passwd",
        content: "malicious",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /escapes/);
    });

    it("should reject delete operation (not supported)", async () => {
      const result = await tool.edit({
        operation: "delete" as any,
        path: "somefile.txt",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /not allowed/i);
    });

    it("should reject replace operation (not supported)", async () => {
      const result = await tool.edit({
        operation: "replace" as any,
        path: "somefile.txt",
        oldString: "a",
        newString: "b",
      } as any);
      assert.equal(result.success, false);
      assert.match(result.message, /not allowed/i);
    });
  });

  // ----------------------------------------------------------------
  // Boundary tests
  // ----------------------------------------------------------------
  describe("boundary", () => {
    it("should write a file directly in the sandbox root", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "root-file.txt",
        content: "root content",
      });
      assert.equal(result.success, true);
      assert.equal(await readFile("root-file.txt"), "root content");
    });

    it("should fail when content is undefined for write", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "no-content.txt",
        content: undefined,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /content is required/i);
    });

    it("getSandboxDir should return the correct resolved sandbox path", () => {
      const expected = path.resolve(sandboxDir);
      assert.equal(tool.getSandboxDir(), expected);
    });

    it("constructor should throw when sandboxDir is empty", () => {
      assert.throws(
        () => new SkillWriteTool(""),
        /Sandbox directory cannot be null or empty/i,
      );
    });
  });
});
