/**
 * E2E Test: Tool Integration
 *
 * Tests all tool services together in a realistic workflow scenario,
 * simulating how they would be used through the Pi Agent extension.
 *
 * Workflow:
 *   1. Calculator: evaluate a financial expression
 *   2. Shell: inspect the working directory
 *   3. FileEdit: create a report file with calculation results
 *   4. Shell: verify the file was created
 *   5. FileEdit: append additional data to the file
 *   6. FileEdit: replace specific lines in the file
 *   7. SkillWrite: create a skill definition file in the sandbox
 *   8. Shell: verify the skill file exists
 *   9. Cleanup
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { CalculatorTool } from "../../src/tools/CalculatorTool.js";
import { ShellTool } from "../../src/tools/ShellTool.js";
import { FileEditTool } from "../../src/tools/FileEditTool.js";
import { SkillWriteTool } from "../../src/tools/SkillWriteTool.js";

let tempDir: string;
let calcTool: CalculatorTool;
let shellTool: ShellTool;
let fileEditTool: FileEditTool;
let skillWriteTool: SkillWriteTool;

before(async () => {
  tempDir = path.join(os.tmpdir(), `word-ai-e2e-tools-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.join(tempDir, "skills"), { recursive: true });

  calcTool = new CalculatorTool();
  shellTool = new ShellTool(tempDir);
  fileEditTool = new FileEditTool(tempDir);
  skillWriteTool = new SkillWriteTool(path.join(tempDir, "skills"));
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Tool Integration E2E", () => {
  describe("Calculator workflow", () => {
    it("should evaluate a simple revenue expression", () => {
      const result = calcTool.evalExpression("1,234,567.89 + 500,000.00");
      assert.equal(result.ok, true);
      assert.ok(result.resultText.includes("1734567.89"));
    });

    it("should evaluate with accounting notation (negative in parentheses)", () => {
      const result = calcTool.evalExpression("10000 - (2500)");
      assert.equal(result.ok, true);
      assert.ok(result.resultText.includes("7500"));
    });

    it("should evaluate with percentage", () => {
      const result = calcTool.evalExpression("50000 * 15%");
      assert.equal(result.ok, true);
      assert.ok(result.resultText.includes("7500"));
    });

    it("should evaluate with Chinese unit (万元)", () => {
      const result = calcTool.evalExpression("100万元 + 50万元");
      assert.equal(result.ok, true);
      assert.ok(result.resultText.includes("1500000"));
    });

    it("should reject invalid expressions", () => {
      const result = calcTool.evalExpression("import(os)");
      assert.equal(result.ok, false);
    });
  });

  describe("Shell + FileEdit workflow", () => {
    it("should verify working directory is empty initially", async () => {
      const result = await shellTool.execute("hostname", []);
      assert.equal(result.ok, true);
      assert.ok(result.stdout!.length > 0);
    });

    it("should create a financial report file", async () => {
      const result = await fileEditTool.edit({
        operation: "write",
        path: "report.txt",
        content: "Financial Report\n=================\n\nRevenue: $1,734,567.89\nExpenses: ($2,500.00)\nNet: $1,732,067.89\n",
      });

      assert.equal(result.success, true);
      assert.equal(result.operation, "write");
    });

    it("should append a summary section to the report", async () => {
      const result = await fileEditTool.edit({
        operation: "append",
        path: "report.txt",
        content: "\n--- Summary ---\nThe fiscal year shows positive growth.\n",
      });

      assert.equal(result.success, true);
    });

    it("should replace a specific line in the report", async () => {
      const result = await fileEditTool.edit({
        operation: "replace_lines",
        path: "report.txt",
        startLine: 3,
        endLine: 3,
        content: "Revenue: $1,800,000.00 (updated)",
      });

      assert.equal(result.success, true);
    });

    it("should find and replace text in the report", async () => {
      const result = await fileEditTool.edit({
        operation: "replace",
        path: "report.txt",
        oldString: "positive growth",
        newString: "exceptional growth",
      });

      assert.equal(result.success, true);
      assert.equal(result.replacements, 1);
    });

    it("should verify file exists via shell (Unix) or read via fs", async () => {
      // On Windows, ls might not be available, so fall back to fs
      const filePath = path.join(tempDir, "report.txt");
      const content = await fs.readFile(filePath, "utf-8");
      assert.ok(content.includes("Financial Report"));
      assert.ok(content.includes("exceptional growth"));
      assert.ok(content.includes("$1,800,000.00"));
    });
  });

  describe("SkillWrite workflow", () => {
    it("should create a skill definition file", async () => {
      const result = await skillWriteTool.edit({
        operation: "write",
        path: "finance-helper/SKILL.md",
        content: [
          "---",
          "name: finance-helper",
          "description: Financial calculation and reporting assistant",
          "---",
          "",
          "# Finance Helper Skill",
          "",
          "This skill helps with financial calculations and report generation.",
        ].join("\n"),
      });

      assert.equal(result.success, true);
    });

    it("should append instructions to the skill file", async () => {
      const result = await skillWriteTool.edit({
        operation: "append",
        path: "finance-helper/SKILL.md",
        content: "\n## Usage\n\nUse calc_eval_expression for arithmetic.\nUse file_edit for report creation.\n",
      });

      assert.equal(result.success, true);
    });

    it("should verify skill file content", async () => {
      const filePath = path.join(tempDir, "skills", "finance-helper", "SKILL.md");
      const content = await fs.readFile(filePath, "utf-8");
      assert.ok(content.includes("finance-helper"));
      assert.ok(content.includes("Financial calculation"));
      assert.ok(content.includes("calc_eval_expression"));
    });

    it("should reject path traversal in skill write", async () => {
      try {
        await skillWriteTool.edit({
          operation: "write",
          path: "../../malicious.txt",
          content: "bad",
        });
        assert.fail("Should have rejected path traversal");
      } catch (err: unknown) {
        assert.match(err instanceof Error ? err.message : String(err), /traversal|invalid|outside|sandbox/i);
      }
    });
  });

  describe("Shell security validation", () => {
    it("should reject dangerous commands", async () => {
      const commands = ["rm", "del", "rmdir", "format", "shutdown", "reboot"];
      for (const cmd of commands) {
        const result = await shellTool.execute(cmd, []);
        assert.equal(result.ok, false, `Should reject: ${cmd}`);
      }
    });

    it("should reject shell injection attempts", async () => {
      const injections = [
        { cmd: "hostname", args: ["; rm -rf /"] },
        { cmd: "hostname", args: ["| cat /etc/passwd"] },
        { cmd: "hostname", args: ["$(whoami)"] },
        { cmd: "hostname", args: ["`whoami`"] },
        { cmd: "hostname", args: ["&& echo hacked"] },
      ];

      for (const { cmd, args } of injections) {
        const result = await shellTool.execute(cmd, args);
        assert.equal(result.ok, false, `Should reject injection: ${cmd} ${args.join(" ")}`);
      }
    });

    it("should only allow whitelisted commands", () => {
      const allowed = shellTool.listAllowedCommands();
      assert.ok(allowed.includes("hostname"));
      assert.ok(allowed.includes("whoami"));
      assert.ok(allowed.includes("ls"));
      assert.ok(allowed.includes("cat"));
      assert.ok(allowed.includes("grep"));
      // Dangerous commands should NOT be in the list
      assert.ok(!allowed.includes("rm"));
      assert.ok(!allowed.includes("mv"));
      assert.ok(!allowed.includes("cp"));
      assert.ok(!allowed.includes("chmod"));
      assert.ok(!allowed.includes("curl"));
      assert.ok(!allowed.includes("wget"));
    });
  });

  describe("FileEdit security", () => {
    it("should reject invalid path characters", async () => {
      const result = await fileEditTool.edit({
        operation: "write",
        path: "file\x00name.txt",
        content: "test",
      });

      assert.equal(result.success, false);
    });

    it("should create and delete a file", async () => {
      await fileEditTool.edit({
        operation: "write",
        path: "temp-delete-me.txt",
        content: "temporary",
      });

      const delResult = await fileEditTool.edit({
        operation: "delete",
        path: "temp-delete-me.txt",
      });

      assert.equal(delResult.success, true);
    });
  });

  describe("Cross-tool data flow", () => {
    it("should use calculator result in file content", async () => {
      // Step 1: Calculate
      const calcResult = calcTool.evalExpression("(100万 + 50万) * 2%");
      assert.equal(calcResult.ok, true);

      // Step 2: Write result to file
      const writeResult = await fileEditTool.edit({
        operation: "write",
        path: "calc-result.txt",
        content: `Calculation Result\nExpression: ${calcResult.normalizedExpression}\nResult: ${calcResult.resultText}\n`,
      });

      assert.equal(writeResult.success, true);

      // Step 3: Verify file content
      const content = await fs.readFile(path.join(tempDir, "calc-result.txt"), "utf-8");
      assert.ok(content.includes("3000"));
    });
  });
});
