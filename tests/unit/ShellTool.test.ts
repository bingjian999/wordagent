import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { CommandRegistry } from "../../src/services/shell/CommandRegistry.js";
import { ShellTool } from "../../src/tools/ShellTool.js";

const isWindows = process.platform === "win32";

let tempDir: string;
let shellTool: ShellTool;
let registry: CommandRegistry;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-shell-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Create test files
  await fs.writeFile(path.join(tempDir, "test.txt"), "line 1\nline 2\nline 3\n");
  await fs.writeFile(path.join(tempDir, "data.csv"), "a,b,c\n1,2,3\n4,5,6\n");
  await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "subdir", "nested.txt"), "nested content");

  registry = new CommandRegistry();
  shellTool = new ShellTool(tempDir, registry, 10000, 512 * 1024);
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("CommandRegistry", () => {
  it("should register default commands", () => {
    const commands = registry.listCommands();
    assert.ok(commands.includes("ls"), "ls should be registered");
    assert.ok(commands.includes("cat"), "cat should be registered");
    assert.ok(commands.includes("grep"), "grep should be registered");
    assert.ok(commands.includes("find"), "find should be registered");
    assert.ok(commands.includes("wc"), "wc should be registered");
    assert.ok(commands.includes("head"), "head should be registered");
    assert.ok(commands.includes("tail"), "tail should be registered");
    assert.ok(commands.includes("echo"), "echo should be registered");
    assert.ok(commands.includes("date"), "date should be registered");
    assert.ok(commands.includes("hostname"), "hostname should be registered");
    assert.ok(commands.includes("whoami"), "whoami should be registered");
  });

  it("should allow registering custom commands", () => {
    const r = new CommandRegistry(false);
    r.register({
      name: "custom",
      args: [{ pattern: /^\w+$/, required: true, description: "input" }],
      flags: [{ name: "-v" }],
      timeout: 5000,
    });
    assert.ok(r.isAllowed("custom"));
    assert.ok(!r.isAllowed("ls"));
  });

  it("should reject unknown commands", () => {
    const result = registry.validate("rm", ["-rf", "/"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /not allowed/i);
  });

  it("should reject commands with shell injection characters", () => {
    const injections = [
      { cmd: "cat", args: ["test.txt; rm -rf /"] },
      { cmd: "cat", args: ["test.txt | cat /etc/passwd"] },
      { cmd: "cat", args: ["test.txt && echo hacked"] },
      { cmd: "cat", args: ["$(whoami)"] },
      { cmd: "cat", args: ["`whoami`"] },
      { cmd: "ls", args: ["; rm -rf /"] },
      { cmd: "grep", args: ["test", "file.txt; echo bad"] },
    ];

    for (const { cmd, args } of injections) {
      const result = registry.validate(cmd, args);
      assert.equal(result.ok, false, `Should reject injection: ${cmd} ${args.join(" ")}`);
    }
  });

  it("should validate required arguments", () => {
    const result = registry.validate("cat", []);
    assert.equal(result.ok, false);
    assert.match(result.error!, /Missing required argument/i);
  });

  it("should validate optional arguments", () => {
    // ls has an optional directory argument
    const result = registry.validate("ls", []);
    assert.equal(result.ok, true);
  });

  it("should validate allowed flags", () => {
    const result = registry.validate("ls", ["-l"]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.validatedArgs, ["-l"]);
  });

  it("should reject disallowed flags", () => {
    const result = registry.validate("ls", ["--exec"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /not allowed/i);
  });

  it("should validate flag values", () => {
    const result = registry.validate("head", ["-n", "5", "test.txt"]);
    assert.equal(result.ok, true);
  });

  it("should reject invalid flag values", () => {
    const result = registry.validate("head", ["-n", "abc", "test.txt"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /not allowed/i);
  });

  it("should reject too many arguments", () => {
    const r = new CommandRegistry(false);
    r.register({
      name: "test",
      args: [{ pattern: /^\w+$/, required: true, description: "arg1" }],
      maxArgs: 1,
    });
    const result = r.validate("test", ["a", "b", "c"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /Too many arguments/i);
  });

  it("should reject extra positional arguments beyond spec", () => {
    // cat has 1 positional arg
    const result = registry.validate("cat", ["file1.txt", "file2.txt"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /Too many positional arguments/i);
  });
});

describe("ShellTool", () => {
  // Cross-platform execution tests (work on both Windows and Unix)
  it("should execute hostname command", async () => {
    const result = await shellTool.execute("hostname", []);
    assert.equal(result.ok, true);
    assert.ok(result.stdout!.length > 0, "hostname should produce output");
    assert.equal(result.exitCode, 0);
  });

  it("should execute whoami command", async () => {
    const result = await shellTool.execute("whoami", []);
    assert.equal(result.ok, true);
    assert.ok(result.stdout!.length > 0, "whoami should produce output");
    assert.equal(result.exitCode, 0);
  });

  it("should reject execution of non-whitelisted commands", async () => {
    const result = await shellTool.execute("rm", ["-rf", "/"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /not allowed/i);
  });

  it("should reject shell injection in arguments", async () => {
    const result = await shellTool.execute("cat", ["test.txt; echo hacked"]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /does not match allowed pattern/i);
  });

  it("should handle command not found gracefully", async () => {
    // Register a command that doesn't exist on the system
    const r = new CommandRegistry(false);
    r.register({
      name: "nonexistentcmd12345",
      args: [],
      timeout: 3000,
    });
    const tool = new ShellTool(tempDir, r, 5000);
    const result = await tool.execute("nonexistentcmd12345", []);
    assert.equal(result.ok, false);
    assert.ok(result.error!.length > 0);
  });

  it("should handle non-zero exit codes", async () => {
    // Use cat on a nonexistent file — cat is registered but will fail
    // On Windows, if cat isn't available, this falls through to the
    // "command not found" error path which also has ok=false
    const result = await shellTool.execute("cat", ["nonexistent_file.txt"]);
    assert.equal(result.ok, false);
  });

  it("should include duration in results", async () => {
    const result = await shellTool.execute("hostname", []);
    assert.equal(result.ok, true);
    assert.ok(result.durationMs !== undefined, "Should have durationMs");
    assert.ok(result.durationMs! >= 0, "Duration should be non-negative");
  });

  it("should list allowed commands", () => {
    const commands = shellTool.listAllowedCommands();
    assert.ok(commands.length >= 11, "Should have at least 11 default commands");
  });

  // Unix-only execution tests (skipped on Windows)
  it("should execute echo on Unix", { skip: isWindows }, async () => {
    const result = await shellTool.execute("echo", ["hello"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /hello/);
    assert.equal(result.exitCode, 0);
  });

  it("should execute cat on a test file (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("cat", ["test.txt"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /line 1/);
    assert.match(result.stdout!, /line 2/);
    assert.match(result.stdout!, /line 3/);
  });

  it("should execute ls on the working directory (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("ls", []);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /test\.txt/);
    assert.match(result.stdout!, /data\.csv/);
  });

  it("should execute ls with flags (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("ls", ["-l"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /[rwx-]/);
  });

  it("should execute head with -n flag (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("head", ["-n", "1", "test.txt"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /line 1/);
    assert.ok(!result.stdout!.includes("line 2"), "Should only show first line");
  });

  it("should execute tail with -n flag (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("tail", ["-n", "1", "test.txt"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /line 3/);
    assert.ok(!result.stdout!.includes("line 1"), "Should only show last line");
  });

  it("should execute wc on a test file (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("wc", ["-l", "test.txt"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /3/);
  });

  it("should execute grep to find text (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("grep", ["line", "test.txt"]);
    assert.equal(result.ok, true);
    assert.match(result.stdout!, /line 1/);
  });

  it("should execute date command (Unix)", { skip: isWindows }, async () => {
    const result = await shellTool.execute("date", []);
    assert.equal(result.ok, true);
    assert.ok(result.stdout!.length > 0, "Date should produce output");
  });
});
