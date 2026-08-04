import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { FileEditTool, type FileEditParams } from "../../src/tools/FileEditTool.js";

let tempDir: string;
let tool: FileEditTool;

before(async () => {
  tempDir = path.join(os.tmpdir(), `fileedit-test-${Date.now()}-${process.pid}`);
  await fs.mkdir(tempDir, { recursive: true });
  tool = new FileEditTool(tempDir);
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// Helper to read a file inside the temp directory
async function readFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(tempDir, relPath), "utf8");
}

describe("FileEditTool", () => {
  // ----------------------------------------------------------------
  // write operation
  // ----------------------------------------------------------------
  describe("write operation", () => {
    it("should write a new file successfully with bytesWritten > 0", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "write-new.txt",
        content: "hello world",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "write");
      assert.ok(result.bytesWritten! > 0);
      assert.equal(result.bytesWritten, Buffer.byteLength("hello world", "utf8"));
      assert.equal(await readFile("write-new.txt"), "hello world");
    });

    it("should overwrite an existing file when overwrite=true", async () => {
      await tool.edit({ operation: "write", path: "overwrite.txt", content: "original" });
      const result = await tool.edit({
        operation: "write",
        path: "overwrite.txt",
        content: "overwritten",
        overwrite: true,
      });
      assert.equal(result.success, true);
      assert.equal(await readFile("overwrite.txt"), "overwritten");
    });

    it("should reject overwrite when overwrite=false and file exists", async () => {
      await tool.edit({ operation: "write", path: "no-overwrite.txt", content: "original" });
      const result = await tool.edit({
        operation: "write",
        path: "no-overwrite.txt",
        content: "new content",
        overwrite: false,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /overwrite is false/i);
      // Original content should be preserved
      assert.equal(await readFile("no-overwrite.txt"), "original");
    });

    it("should create parent directories when createParents=true", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "subdir/nested/deep.txt",
        content: "nested content",
        createParents: true,
      });
      assert.equal(result.success, true);
      assert.equal(await readFile("subdir/nested/deep.txt"), "nested content");
    });

    it("should fail when createParents=false and parent directory does not exist", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "noparent-x/subdir/file.txt",
        content: "content",
        createParents: false,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /createParents is false/i);
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
  });

  // ----------------------------------------------------------------
  // append operation
  // ----------------------------------------------------------------
  describe("append operation", () => {
    it("should append content to an existing file", async () => {
      await tool.edit({ operation: "write", path: "append-existing.txt", content: "hello" });
      const result = await tool.edit({
        operation: "append",
        path: "append-existing.txt",
        content: " world",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "append");
      assert.ok(result.bytesWritten! > 0);
      assert.equal(await readFile("append-existing.txt"), "hello world");
    });

    it("should append content to a new file (creating it)", async () => {
      const result = await tool.edit({
        operation: "append",
        path: "append-new.txt",
        content: "new content",
      });
      assert.equal(result.success, true);
      assert.equal(await readFile("append-new.txt"), "new content");
    });

    it("should fail when content is undefined for append", async () => {
      const result = await tool.edit({
        operation: "append",
        path: "append-no-content.txt",
        content: undefined,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /content is required/i);
    });
  });

  // ----------------------------------------------------------------
  // replace operation
  // ----------------------------------------------------------------
  describe("replace operation", () => {
    it("should replace the first occurrence only", async () => {
      await tool.edit({
        operation: "write",
        path: "replace-first.txt",
        content: "foo bar foo baz foo",
      });
      const result = await tool.edit({
        operation: "replace",
        path: "replace-first.txt",
        oldString: "foo",
        newString: "qux",
      });
      assert.equal(result.success, true);
      assert.equal(result.replacements, 1);
      assert.equal(await readFile("replace-first.txt"), "qux bar foo baz foo");
    });

    it("should replace all occurrences when replaceAll=true", async () => {
      await tool.edit({
        operation: "write",
        path: "replace-all.txt",
        content: "foo bar foo baz foo",
      });
      const result = await tool.edit({
        operation: "replace",
        path: "replace-all.txt",
        oldString: "foo",
        newString: "qux",
        replaceAll: true,
      });
      assert.equal(result.success, true);
      assert.equal(result.replacements, 3);
      assert.equal(await readFile("replace-all.txt"), "qux bar qux baz qux");
    });

    it("should fail when oldString is empty", async () => {
      await tool.edit({ operation: "write", path: "replace-empty-old.txt", content: "hello" });
      const result = await tool.edit({
        operation: "replace",
        path: "replace-empty-old.txt",
        oldString: "",
        newString: "world",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /oldString is required/i);
    });

    it("should fail when oldString is not found in the file", async () => {
      await tool.edit({
        operation: "write",
        path: "replace-not-found.txt",
        content: "hello world",
      });
      const result = await tool.edit({
        operation: "replace",
        path: "replace-not-found.txt",
        oldString: "nonexistent",
        newString: "found",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /not found/i);
    });

    it("should delete matched text when newString is empty string", async () => {
      await tool.edit({
        operation: "write",
        path: "replace-delete.txt",
        content: "hello world",
      });
      const result = await tool.edit({
        operation: "replace",
        path: "replace-delete.txt",
        oldString: "world",
        newString: "",
      });
      assert.equal(result.success, true);
      assert.equal(result.replacements, 1);
      assert.equal(await readFile("replace-delete.txt"), "hello ");
    });
  });

  // ----------------------------------------------------------------
  // replace_lines operation
  // ----------------------------------------------------------------
  describe("replace_lines operation", () => {
    it("should replace a single line when startLine === endLine", async () => {
      await tool.edit({
        operation: "write",
        path: "rl-single.txt",
        content: "line1\nline2\nline3\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "rl-single.txt",
        startLine: 2,
        endLine: 2,
        content: "replaced",
      });
      assert.equal(result.success, true);
      assert.equal(result.replacements, 1);
      assert.equal(await readFile("rl-single.txt"), "line1\nreplaced\nline3\n");
    });

    it("should replace a range of multiple lines", async () => {
      await tool.edit({
        operation: "write",
        path: "rl-multi.txt",
        content: "line1\nline2\nline3\nline4\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "rl-multi.txt",
        startLine: 2,
        endLine: 3,
        content: "replaced",
      });
      assert.equal(result.success, true);
      assert.equal(result.replacements, 2);
      assert.equal(await readFile("rl-multi.txt"), "line1\nreplaced\nline4\n");
    });

    it("should fail when startLine exceeds file line count", async () => {
      await tool.edit({
        operation: "write",
        path: "rl-overflow.txt",
        content: "line1\nline2\nline3\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "rl-overflow.txt",
        startLine: 10,
        endLine: 10,
        content: "replaced",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /beyond the end of the file/i);
    });

    it("should fail when endLine < startLine", async () => {
      await tool.edit({
        operation: "write",
        path: "rl-reversed.txt",
        content: "line1\nline2\nline3\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "rl-reversed.txt",
        startLine: 3,
        endLine: 1,
        content: "replaced",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /endLine must be greater than or equal to startLine/i);
    });

    it("should fail when startLine < 1", async () => {
      await tool.edit({
        operation: "write",
        path: "rl-zero.txt",
        content: "line1\nline2\n",
      });
      const result = await tool.edit({
        operation: "replace_lines",
        path: "rl-zero.txt",
        startLine: 0,
        endLine: 1,
        content: "replaced",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /startLine is required and must be greater than 0/i);
    });
  });

  // ----------------------------------------------------------------
  // delete operation
  // ----------------------------------------------------------------
  describe("delete operation", () => {
    it("should delete an existing file", async () => {
      await tool.edit({ operation: "write", path: "delete-existing.txt", content: "delete me" });
      const result = await tool.edit({
        operation: "delete",
        path: "delete-existing.txt",
      });
      assert.equal(result.success, true);
      assert.equal(result.operation, "delete");
      assert.equal(result.message, "File deleted.");
      // Verify the file is gone
      await assert.rejects(fs.stat(path.join(tempDir, "delete-existing.txt")));
    });

    it("should fail when deleting a non-existent file", async () => {
      const result = await tool.edit({
        operation: "delete",
        path: "never-existed.txt",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /does not exist/i);
    });

    it("should fail when deleting a directory", async () => {
      await fs.mkdir(path.join(tempDir, "delete-dir-target"), { recursive: true });
      const result = await tool.edit({
        operation: "delete",
        path: "delete-dir-target",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /directory/i);
    });
  });

  // ----------------------------------------------------------------
  // General / error handling
  // ----------------------------------------------------------------
  describe("general error handling", () => {
    it("should fail with an invalid operation name", async () => {
      const result = await tool.edit({
        operation: "invalid_op",
        path: "somefile.txt",
        content: "test",
      } as unknown as FileEditParams);
      assert.equal(result.success, false);
      assert.match(result.message, /invalid operation/i);
    });

    it("should fail when path contains invalid characters", async () => {
      const result = await tool.edit({
        operation: "write",
        path: "file<n>.txt",
        content: "test",
      });
      assert.equal(result.success, false);
      assert.match(result.message, /invalid characters/i);
    });
  });
});
