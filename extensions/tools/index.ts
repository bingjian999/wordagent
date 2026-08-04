/**
 * Word AI - Tools Extension
 *
 * Provides Pi Agent tools for general-purpose operations:
 *   - calc_eval_expression:  Evaluate arithmetic expressions with decimal precision
 *   - web_fetch:             Fetch public web URLs and return cleaned text
 *   - file_edit:             Edit local files (write/append/replace/replace_lines/delete)
 *   - skill_write:           Write files within the skills sandbox directory
 *   - shell_exec:            Execute whitelisted shell commands in a sandbox
 *   - docx_operate:          Parse and generate Word (.docx) documents
 *
 * All tools are registered with the Pi Agent Extension API and share
 * tool service instances initialized in session_start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import { CalculatorTool } from "../../src/tools/CalculatorTool.js";
import { WebFetchTool } from "../../src/tools/WebFetchTool.js";
import { FileEditTool } from "../../src/tools/FileEditTool.js";
import { SkillWriteTool } from "../../src/tools/SkillWriteTool.js";
import { ShellTool } from "../../src/tools/ShellTool.js";
import { DocxTool } from "../../src/tools/DocxTool.js";
import type { ParagraphSpec } from "../../src/services/docx/DocxService.js";
import type { TableSpec } from "../../src/services/docx/DocxService.js";

// Module-level state for session-scoped tool instances
let calcTool: CalculatorTool | null = null;
let webFetchTool: WebFetchTool | null = null;
let fileEditTool: FileEditTool | null = null;
let skillWriteTool: SkillWriteTool | null = null;
let shellTool: ShellTool | null = null;
let docxTool: DocxTool | null = null;

export default function (pi: ExtensionAPI) {
  // ================================================================
  // Lifecycle: session_start — initialize tool instances
  // ================================================================
  pi.on("session_start", async (_event, ctx) => {
    const projectDir = process.cwd();

    calcTool = new CalculatorTool();
    webFetchTool = new WebFetchTool();
    fileEditTool = new FileEditTool(projectDir);
    skillWriteTool = new SkillWriteTool(path.join(projectDir, "skills"));
    shellTool = new ShellTool(projectDir);
    docxTool = new DocxTool();

    console.log("[Tools] All tools initialized.");
    console.log(`[Tools]   file_edit base: ${projectDir}`);
    console.log(`[Tools]   skill_write sandbox: ${skillWriteTool.getSandboxDir()}`);
    console.log(`[Tools]   shell_exec cwd: ${projectDir}`);
    console.log(`[Tools]   shell_exec allowed: ${shellTool.listAllowedCommands().join(", ")}`);
    console.log("[Tools]   docx_operate ready (parse + generate)");

    if (ctx.hasUI) {
      ctx.ui.notify("Word AI: Tools ready (calc, web_fetch, file_edit, skill_write, shell_exec, docx_operate)", "info");
    }
  });

  // ================================================================
  // Lifecycle: session_shutdown — cleanup
  // ================================================================
  pi.on("session_shutdown", async () => {
    calcTool = null;
    webFetchTool = null;
    fileEditTool = null;
    skillWriteTool = null;
    shellTool = null;
    docxTool = null;
    console.log("[Tools] All tools cleaned up.");
  });

  // ================================================================
  // Tool: calc_eval_expression
  // ================================================================
  pi.registerTool({
    name: "calc_eval_expression",
    label: "Evaluate Expression",
    description:
      "Evaluate a local arithmetic expression with decimal arithmetic. " +
      "Supports +, -, *, /, parentheses, thousands separators, full-width digits, " +
      "percentages, and common accounting number formats (e.g. (123.45) for -123.45, " +
      "万元 for ×10000). Returns the result and normalized expression.",
    promptSnippet: "Evaluate arithmetic expressions (supports thousands separators, percentages, accounting format, 万元 units)",
    promptGuidelines: ["Use calc_eval_expression when the user asks to calculate or evaluate a math expression."],
    parameters: Type.Object({
      expression: Type.String({
        description:
          "Arithmetic expression to evaluate, e.g. 1,234.56 - 200.00 * 3 or (100万 + 50万) * 2%",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!calcTool) {
        return errorResult("Calculator tool not initialized");
      }

      const expression = params.expression as string;
      const result = calcTool.evalExpression(expression);

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
          details: result,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Expression: ${result.expression}\nNormalized: ${result.normalizedExpression}\nResult: ${result.resultText}\nDuration: ${result.durationMs}ms`,
          },
        ],
        details: result,
      };
    },
  });

  // ================================================================
  // Tool: web_fetch
  // ================================================================
  pi.registerTool({
    name: "web_fetch",
    label: "Fetch Web Page",
    description:
      "Fetch a public HTTP/HTTPS URL and return cleaned text content. " +
      "Only public web URLs on ports 80/443 are allowed; " +
      "localhost and private network addresses are blocked (SSRF protection). " +
      "HTML is cleaned to readable text with title extraction.",
    promptSnippet: "Fetch and extract text content from a public web URL",
    promptGuidelines: ["Use web_fetch when the user asks to retrieve content from a web page."],
    parameters: Type.Object({
      url: Type.String({ description: "The public HTTP/HTTPS URL to fetch" }),
      maxChars: Type.Optional(
        Type.Number({
          description: "Optional maximum number of text characters to return (default 20000, max 50000)",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      if (!webFetchTool) {
        return errorResult("Web fetch tool not initialized");
      }

      const url = params.url as string;
      const maxChars = params.maxChars as number | undefined;

      onUpdate?.({
        content: [{ type: "text" as const, text: `Fetching ${url}...` }],
        details: { progress: 20 },
      });

      const result = await webFetchTool.fetch(url, maxChars);

      if (signal?.aborted) {
        return { content: [{ type: "text" as const, text: "Cancelled" }], details: { cancelled: true } };
      }

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
          details: result,
        };
      }

      const summary = [
        `URL: ${result.url}`,
        result.finalUrl && result.finalUrl !== result.url ? `Final URL: ${result.finalUrl}` : "",
        `Status: ${result.statusCode}`,
        result.title ? `Title: ${result.title}` : "",
        result.contentType ? `Content-Type: ${result.contentType}` : "",
        result.truncated ? "(truncated)" : "",
        `Duration: ${result.durationMs}ms`,
        "",
        result.text ?? "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        details: result,
      };
    },
  });

  // ================================================================
  // Tool: file_edit
  // ================================================================
  pi.registerTool({
    name: "file_edit",
    label: "Edit File",
    description:
      "Edit local text files. Supports write, append, replace, replace_lines, and delete. " +
      "This is a high-risk filesystem tool. Absolute paths are accepted; " +
      "relative paths resolve from the project directory.",
    promptSnippet: "Edit local files (write, append, find-replace, replace lines, delete)",
    promptGuidelines: ["Use file_edit for any file creation, modification, or deletion operation."],
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal("write"),
          Type.Literal("append"),
          Type.Literal("replace"),
          Type.Literal("replace_lines"),
          Type.Literal("delete"),
        ],
        {
          description:
            "Operation: write (create/overwrite), append (add to end), " +
            "replace (find & replace text), replace_lines (replace line range), delete (remove file)",
        },
      ),
      path: Type.String({
        description: "File path. Absolute paths accepted; relative paths resolve from the project directory.",
      }),
      content: Type.Optional(
        Type.String({
          description: "Text content for write, append, and replace_lines. Required for those operations.",
        }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({
          description: "For write only. If false and file exists, operation fails. Default true.",
        }),
      ),
      oldString: Type.Optional(
        Type.String({ description: "For replace only. Existing text to find. Must not be empty." }),
      ),
      newString: Type.Optional(
        Type.String({
          description: "For replace only. Replacement text. Empty string removes the found text.",
        }),
      ),
      replaceAll: Type.Optional(
        Type.Boolean({
          description: "For replace only. If true, replace all occurrences. Default false.",
        }),
      ),
      startLine: Type.Optional(
        Type.Number({
          description: "For replace_lines only. 1-based inclusive start line.",
        }),
      ),
      endLine: Type.Optional(
        Type.Number({
          description: "For replace_lines only. 1-based inclusive end line. Defaults to startLine.",
        }),
      ),
      createParents: Type.Optional(
        Type.Boolean({
          description: "For write and append. Create parent directories when missing. Default true.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      if (!fileEditTool) {
        return errorResult("File edit tool not initialized");
      }

      const result = await fileEditTool.edit({
        operation: params.operation as "write" | "append" | "replace" | "replace_lines" | "delete",
        path: params.path as string,
        content: params.content as string | undefined,
        overwrite: params.overwrite as boolean | undefined,
        oldString: params.oldString as string | undefined,
        newString: params.newString as string | undefined,
        replaceAll: params.replaceAll as boolean | undefined,
        startLine: params.startLine as number | undefined,
        endLine: params.endLine as number | undefined,
        createParents: params.createParents as boolean | undefined,
      });

      onUpdate?.({
        content: [{ type: "text" as const, text: `${params.operation} → ${params.path}` }],
        details: { progress: 80 },
      });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.message}` }],
          isError: true,
          details: result,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${result.operation} succeeded: ${result.path}\n${result.message}` +
              (result.bytesWritten !== undefined ? `\nBytes: ${result.bytesWritten}` : "") +
              (result.replacements !== undefined ? `\nReplacements: ${result.replacements}` : ""),
          },
        ],
        details: result,
      };
    },
  });

  // ================================================================
  // Tool: skill_write
  // ================================================================
  pi.registerTool({
    name: "skill_write",
    label: "Write Skill File",
    description:
      "Write files within the skills sandbox directory. " +
      "Supports write, append, and replace_lines only (no delete or free-text replace). " +
      "Paths must be relative to the skills directory. " +
      "Path traversal attempts (e.g. ../../) are blocked.",
    promptSnippet: "Write files within the skills sandbox directory (write, append, replace lines)",
    promptGuidelines: ["Use skill_write to create or modify skill definition files in the skills directory."],
    parameters: Type.Object({
      operation: Type.Union(
        [Type.Literal("write"), Type.Literal("append"), Type.Literal("replace_lines")],
        {
          description:
            "Operation: write (create/overwrite), append (add to end), replace_lines (replace line range)",
        },
      ),
      path: Type.String({
        description: "File path relative to the skills directory (e.g. 'my-skill/SKILL.md').",
      }),
      content: Type.Optional(
        Type.String({
          description: "Text content for write, append, and replace_lines.",
        }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({
          description: "For write only. If false and file exists, operation fails. Default true.",
        }),
      ),
      startLine: Type.Optional(
        Type.Number({ description: "For replace_lines only. 1-based inclusive start line." }),
      ),
      endLine: Type.Optional(
        Type.Number({
          description: "For replace_lines only. 1-based inclusive end line. Defaults to startLine.",
        }),
      ),
      createParents: Type.Optional(
        Type.Boolean({
          description: "For write and append. Create parent directories when missing. Default true.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      if (!skillWriteTool) {
        return errorResult("Skill write tool not initialized");
      }

      const result = await skillWriteTool.edit({
        operation: params.operation as "write" | "append" | "replace_lines",
        path: params.path as string,
        content: params.content as string | undefined,
        overwrite: params.overwrite as boolean | undefined,
        startLine: params.startLine as number | undefined,
        endLine: params.endLine as number | undefined,
        createParents: params.createParents as boolean | undefined,
      });

      onUpdate?.({
        content: [{ type: "text" as const, text: `${params.operation} → skills/${params.path}` }],
        details: { progress: 80 },
      });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.message}` }],
          isError: true,
          details: result,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${result.operation} succeeded: skills/${result.path}\n${result.message}` +
              (result.bytesWritten !== undefined ? `\nBytes: ${result.bytesWritten}` : ""),
          },
        ],
        details: result,
      };
    },
  });

  // ================================================================
  // Tool: shell_exec
  // ================================================================
  pi.registerTool({
    name: "shell_exec",
    label: "Execute Shell Command",
    description:
      "Execute a whitelisted shell command in a sandboxed environment. " +
      "Only read-only commands are allowed (ls, cat, head, tail, wc, grep, find, file, echo, date, hostname, whoami). " +
      "Commands are executed via execFile (no shell parsing) to prevent injection. " +
      "Arguments are validated against regex patterns. " +
      "The working directory is locked to the project directory.",
    promptSnippet: "Execute safe read-only shell commands (ls, cat, grep, find, wc, head, tail, file, echo, date, hostname, whoami)",
    promptGuidelines: [
      "Use shell_exec for read-only file inspection and text search operations.",
      "Only whitelisted commands are accepted; write/execute commands are blocked.",
    ],
    parameters: Type.Object({
      command: Type.String({
        description:
          "The command to execute. Must be one of the allowed commands: " +
          "ls, cat, head, tail, wc, grep, find, file, echo, date, hostname, whoami.",
      }),
      args: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Arguments for the command. Each argument is validated against the command's allowed pattern. " +
            "Shell metacharacters (;, |, &, $, backticks, etc.) are rejected.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      if (!shellTool) {
        return errorResult("Shell tool not initialized");
      }

      const command = params.command as string;
      const args = (params.args as string[]) ?? [];

      onUpdate?.({
        content: [{ type: "text" as const, text: `Executing: ${command} ${args.join(" ")}` }],
        details: { progress: 20 },
      });

      const result = await shellTool.execute(command, args);

      if (signal?.aborted) {
        return { content: [{ type: "text" as const, text: "Cancelled" }], details: { cancelled: true } };
      }

      if (!result.ok) {
        const lines = [
          `Command: ${result.command ?? command}`,
          result.timedOut ? `Timed out after ${result.durationMs}ms` : `Error: ${result.error}`,
          result.exitCode !== undefined ? `Exit code: ${result.exitCode}` : "",
          result.stdout ? `\nstdout:\n${result.stdout}` : "",
          result.stderr ? `\nstderr:\n${result.stderr}` : "",
          `Duration: ${result.durationMs}ms`,
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: lines }],
          isError: true,
          details: result,
        };
      }

      const summary = [
        `Command: ${result.command}`,
        `Exit code: ${result.exitCode}`,
        `Duration: ${result.durationMs}ms`,
        "",
        result.stdout ?? "(no output)",
        result.stderr ? `\nstderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        details: result,
      };
    },
  });

  // ================================================================
  // Tool: docx_operate
  // ================================================================
  pi.registerTool({
    name: "docx_operate",
    label: "Word Document Operations",
    description:
      "Parse and generate Word (.docx) documents. " +
      "Operations: " +
      "parse (extract text from a .docx file), " +
      "generate (create a .docx from structured content with paragraphs, headings, and tables).",
    promptSnippet: "Parse and generate Word (.docx) documents (text extraction, report generation)",
    promptGuidelines: [
      "Use docx_operate with operation 'parse' to extract text from a .docx file.",
      "Use docx_operate with operation 'generate' to create a .docx document from paragraphs and tables.",
    ],
    parameters: Type.Object({
      operation: Type.Union(
        [Type.Literal("parse"), Type.Literal("generate")],
        {
          description:
            "Operation: parse (extract text from .docx) or generate (create .docx from structured content)",
        },
      ),
      filePath: Type.String({
        description:
          "For 'parse': path to the .docx file to read. " +
          "For 'generate': output path for the generated .docx file.",
      }),
      title: Type.Optional(
        Type.String({ description: "For 'generate' only. Document title placed at the top." }),
      ),
      paragraphs: Type.Optional(
        Type.Array(
          Type.Object({
            text: Type.String({ description: "Paragraph text content." }),
            heading: Type.Optional(
              Type.Union(
                [
                  Type.Literal("Title"),
                  Type.Literal("Heading1"),
                  Type.Literal("Heading2"),
                  Type.Literal("Heading3"),
                  Type.Literal("normal"),
                ],
                { description: "Heading level. Default 'normal'." },
              ),
            ),
            bold: Type.Optional(Type.Boolean({ description: "Bold text." })),
            italic: Type.Optional(Type.Boolean({ description: "Italic text." })),
            alignment: Type.Optional(
              Type.Union(
                [Type.Literal("left"), Type.Literal("center"), Type.Literal("right"), Type.Literal("justify")],
                { description: "Text alignment." },
              ),
            ),
            bullet: Type.Optional(Type.Boolean({ description: "Bullet list item." })),
            fontSize: Type.Optional(Type.Number({ description: "Font size in points (default 11)." })),
          }),
          { description: "For 'generate' only. Array of paragraph specifications." },
        ),
      ),
      tables: Type.Optional(
        Type.Array(
          Type.Object({
            rows: Type.Array(
              Type.Array(Type.String()),
              { description: "Table rows, each row is an array of cell texts." },
            ),
            headerRow: Type.Optional(
              Type.Boolean({ description: "Whether the first row is a header (bold, shaded). Default false." }),
            ),
            columnWidths: Type.Optional(
              Type.Array(Type.Number(), { description: "Column widths in percentages (must sum to 100)." }),
            ),
          }),
          { description: "For 'generate' only. Array of table specifications." },
        ),
      ),
      creator: Type.Optional(
        Type.String({ description: "For 'generate' only. Document creator metadata." }),
      ),
      description: Type.Optional(
        Type.String({ description: "For 'generate' only. Document description metadata." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      if (!docxTool) {
        return errorResult("Docx tool not initialized");
      }

      const result = await docxTool.execute({
        operation: params.operation as "parse" | "generate",
        filePath: params.filePath as string,
        title: params.title as string | undefined,
        paragraphs: params.paragraphs as unknown as ParagraphSpec[] | undefined,
        tables: params.tables as unknown as TableSpec[] | undefined,
        creator: params.creator as string | undefined,
        description: params.description as string | undefined,
      });

      onUpdate?.({
        content: [{ type: "text" as const, text: `docx ${params.operation} → ${params.filePath}` }],
        details: { progress: 80 },
      });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.message}` }],
          isError: true,
          details: result,
        };
      }

      if (params.operation === "parse") {
        const text = result.text ?? "";
        const preview = text.length > 2000 ? text.substring(0, 2000) + "\n...(truncated)" : text;
        return {
          content: [
            {
              type: "text" as const,
              text: `Parsed '${params.filePath}': ${result.charCount} characters\n\n${preview}`,
            },
          ],
          details: result,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Generated '${result.filePath}': ${result.size} bytes`,
          },
        ],
        details: result,
      };
    },
  });
}

// ================================================================
// Helpers
// ================================================================

function errorResult(message: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
    details: { error: message, ...details },
  };
}
