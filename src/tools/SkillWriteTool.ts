/**
 * @file SkillWriteTool.ts
 *
 * Sandboxed file editing tool that restricts all write operations to a
 * designated skill directory. Supports write, append, and replace_lines
 * operations only — delete and free-text replace are intentionally omitted
 * for safety.
 *
 * This tool wraps {@link FileEditTool} with an additional containment check
 * using {@link PathResolver.contains} to ensure every resolved path stays
 * within the sandbox boundary.
 */

import * as path from "node:path";
import { FileEditTool, type FileEditParams, type FileEditResult } from "./FileEditTool.js";
import { PathResolver } from "./PathResolver.js";

// ------------------------------------------------------------------
// Public interfaces
// ------------------------------------------------------------------

/**
 * Parameters for {@link SkillWriteTool.edit}.
 *
 * A subset of {@link FileEditParams} — only `write`, `append`, and
 * `replace_lines` operations are permitted.
 */
export interface SkillWriteParams {
  /**
   * Operation to perform.
   *
   * - `write` — write content to a file (overwrite by default).
   * - `append` — append content to the end of a file.
   * - `replace_lines` — replace a range of lines within a file.
   */
  operation: "write" | "append" | "replace_lines";

  /**
   * File path **relative to the sandbox directory**. Absolute paths are
   * rejected — all paths must be relative to prevent escaping the sandbox.
   */
  path: string;

  /** Text content for `write`, `append`, and `replace_lines`. */
  content?: string;

  /** For `write` only. If `false` and the target file exists, the operation fails. Defaults to `true`. */
  overwrite?: boolean;

  /** For `replace_lines` only. 1-based inclusive start line. */
  startLine?: number;

  /** For `replace_lines` only. 1-based inclusive end line. Defaults to `startLine`. */
  endLine?: number;

  /** For `write` and `append`. Create parent directories when missing. Defaults to `true`. */
  createParents?: boolean;
}

/**
 * Result of a skill write operation. Same structure as {@link FileEditResult}.
 */
export type SkillWriteResult = FileEditResult;

// ------------------------------------------------------------------
// SkillWriteTool
// ------------------------------------------------------------------

/**
 * Sandboxed file editing tool for the skills directory.
 *
 * All file operations are confined to a designated sandbox directory.
 * Relative paths are resolved against the sandbox root, and the resolved
 * path is validated to ensure it does not escape the sandbox via path
 * traversal (e.g., `../../etc/passwd`).
 *
 * Only `write`, `append`, and `replace_lines` operations are supported.
 * `delete` and `replace` (free-text find-and-replace) are intentionally
 * excluded for safety in a sandboxed context.
 *
 * @example
 * ```ts
 * const tool = new SkillWriteTool("./skills");
 * await tool.edit({
 *   operation: "write",
 *   path: "my-skill/SKILL.md",
 *   content: "# My Skill\n\nA custom skill definition.\n",
 * });
 * ```
 */
export class SkillWriteTool {
  /** The underlying FileEditTool instance. */
  private readonly fileEditTool: FileEditTool;

  /** Absolute, normalized sandbox directory path. */
  private readonly sandboxDir: string;

  /**
   * Create a new SkillWriteTool.
   *
   * @param sandboxDir - The sandbox directory. All file operations will be
   *                     confined to this directory. Created if it does not
   *                     exist.
   * @throws {Error} When `sandboxDir` is null or empty.
   */
  constructor(sandboxDir: string) {
    if (!sandboxDir) {
      throw new Error("Sandbox directory cannot be null or empty.");
    }
    this.sandboxDir = path.resolve(sandboxDir);
    this.fileEditTool = new FileEditTool(this.sandboxDir);
  }

  /**
   * Execute a sandboxed file edit operation.
   *
   * The method first validates that the path is relative (absolute paths are
   * rejected to prevent sandbox escape), resolves it against the sandbox
   * directory, and verifies the resolved path stays within the sandbox. Only
   * then is the operation delegated to the underlying {@link FileEditTool}.
   *
   * @param params - Operation parameters.
   * @returns A {@link SkillWriteResult} describing the outcome.
   */
  async edit(params: SkillWriteParams): Promise<SkillWriteResult> {
    try {
      // 1. Reject absolute paths — all paths must be relative to the sandbox
      if (path.isAbsolute(params.path)) {
        return {
          success: false,
          operation: params.operation,
          path: params.path,
          message: "Absolute paths are not allowed. Use a path relative to the skills directory.",
        };
      }

      // 2. Resolve the path against the sandbox directory
      const resolvedPath = path.resolve(this.sandboxDir, params.path);

      // 3. Verify the resolved path is within the sandbox
      if (!PathResolver.contains(this.sandboxDir, resolvedPath)) {
        return {
          success: false,
          operation: params.operation,
          path: params.path,
          message: "Path escapes the skills sandbox directory.",
        };
      }

      // 4. Validate operation is allowed
      const allowedOps: SkillWriteParams["operation"][] = ["write", "append", "replace_lines"];
      if (!allowedOps.includes(params.operation)) {
        return {
          success: false,
          operation: params.operation,
          path: params.path,
          message: `Operation "${params.operation}" is not allowed. Use write, append, or replace_lines.`,
        };
      }

      // 5. Delegate to FileEditTool with the resolved absolute path
      const fileEditParams: FileEditParams = {
        operation: params.operation,
        path: resolvedPath,
        content: params.content,
        overwrite: params.overwrite,
        startLine: params.startLine,
        endLine: params.endLine,
        createParents: params.createParents,
      };

      const result = await this.fileEditTool.edit(fileEditParams);

      // 6. Return result with the original (relative) path for user clarity
      return {
        ...result,
        path: params.path,
      };
    } catch (err) {
      return {
        success: false,
        operation: params.operation,
        path: params.path,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get the absolute sandbox directory path.
   *
   * @returns The resolved sandbox directory.
   */
  getSandboxDir(): string {
    return this.sandboxDir;
  }
}
