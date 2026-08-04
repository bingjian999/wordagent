/**
 * @file FileEditTool.ts
 *
 * File editing tool supporting write, append, replace, replace_lines, and
 * delete operations. Ported from the C# `GenericFileEditToolProvider`.
 *
 * All operations use UTF-8 encoding **without** BOM for writing. When
 * reading existing files (for replace and replace_lines), a leading UTF-8
 * BOM is stripped to match the C# `Encoding.UTF8` read behavior.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LineDocument } from "./LineDocument.js";
import { PathResolver } from "./PathResolver.js";

// ------------------------------------------------------------------
// Public interfaces
// ------------------------------------------------------------------

/**
 * Parameters for {@link FileEditTool.edit}.
 */
export interface FileEditParams {
  /**
   * Operation to perform.
   *
   * - `write` — write content to a file (overwrite by default).
   * - `append` — append content to the end of a file.
   * - `replace` — find and replace text within a file.
   * - `replace_lines` — replace a range of lines within a file.
   * - `delete` — delete a file.
   */
  operation: "write" | "append" | "replace" | "replace_lines" | "delete";

  /**
   * File path. Absolute paths are used directly; relative paths resolve
   * against the base directory provided to the {@link FileEditTool}
   * constructor.
   */
  path: string;

  /**
   * Text content for `write`, `append`, and `replace_lines`.
   *
   * Required for those operations. An empty string is valid (writes no
   * text); `undefined` or `null` is rejected.
   */
  content?: string;

  /**
   * For `write` only. If `false` and the target file exists, the
   * operation fails. Defaults to `true`.
   */
  overwrite?: boolean;

  /**
   * For `replace` only. The existing text to find. Must not be empty.
   */
  oldString?: string;

  /**
   * For `replace` only. The replacement text. An empty string is allowed
   * (effectively deletes the matched text). `undefined` is not allowed.
   */
  newString?: string;

  /**
   * For `replace` only. If `true`, replace all occurrences; otherwise
   * replace only the first occurrence. Defaults to `false`.
   */
  replaceAll?: boolean;

  /**
   * For `replace_lines` only. 1-based inclusive start line. Must be >= 1.
   */
  startLine?: number;

  /**
   * For `replace_lines` only. 1-based inclusive end line. Must be >=
   * `startLine`. Defaults to `startLine`.
   */
  endLine?: number;

  /**
   * For `write` and `append`. When `true`, create missing parent
   * directories. Defaults to `true`.
   */
  createParents?: boolean;
}

/**
 * Result of a file edit operation.
 */
export interface FileEditResult {
  /** Whether the operation succeeded. */
  success: boolean;

  /** The normalized (lowercase, trimmed) operation name. */
  operation: string;

  /**
   * The resolved file path. When path resolution fails, this is the
   * original input path.
   */
  path: string;

  /** Human-readable status or error message. */
  message: string;

  /**
   * Number of UTF-8 bytes written (for `write`, `append`, `replace`,
   * and `replace_lines`).
   */
  bytesWritten?: number;

  /** Number of replacements made (for `replace` and `replace_lines`). */
  replacements?: number;
}

// ------------------------------------------------------------------
// FileEditTool
// ------------------------------------------------------------------

/**
 * FileEditTool — a multi-operation file editing tool.
 *
 * Ported from the C# `GenericFileEditToolProvider`. Supports five
 * operations dispatched through a single {@link FileEditTool.edit} method:
 *
 * - **write** — write content to a file, with optional overwrite control.
 * - **append** — append content to the end of a file.
 * - **replace** — find-and-replace text (first or all occurrences).
 * - **replace_lines** — replace a 1-based inclusive line range.
 * - **delete** — delete a file (directories are not allowed).
 *
 * Key behaviors:
 * - All file I/O uses Node.js `fs/promises` (async).
 * - Files are written as UTF-8 **without** BOM.
 * - When reading for replace/replace_lines, a leading UTF-8 BOM is stripped.
 * - Errors are returned as `{ success: false, ... }` results — the
 *   {@link FileEditTool.edit} method never throws.
 * - Path resolution and validation is delegated to {@link PathResolver}.
 * - Line-level operations use {@link LineDocument} to preserve the
 *   original newline style and trailing-newline convention.
 *
 * @example
 * ```ts
 * const tool = new FileEditTool("/home/user/project");
 *
 * // Write a file
 * await tool.edit({
 *   operation: "write",
 *   path: "src/hello.ts",
 *   content: 'console.log("Hello, world!");\n',
 * });
 *
 * // Replace text
 * await tool.edit({
 *   operation: "replace",
 *   path: "src/hello.ts",
 *   oldString: "Hello, world!",
 *   newString: "Hello, FileEditTool!",
 * });
 *
 * // Replace lines 1-2
 * await tool.edit({
 *   operation: "replace_lines",
 *   path: "src/hello.ts",
 *   startLine: 1,
 *   endLine: 2,
 *   content: '// File header\n',
 * });
 * ```
 */
export class FileEditTool {
  /** Internal path resolver for validating and normalizing paths. */
  private readonly pathResolver: PathResolver;

  /**
   * Create a new FileEditTool.
   *
   * @param baseDir - Base directory for resolving relative paths.
   * @throws {Error} When `baseDir` is null or empty (delegated to
   *                 {@link PathResolver}).
   */
  constructor(baseDir: string) {
    this.pathResolver = new PathResolver(baseDir);
  }

  /**
   * Execute a file edit operation.
   *
   * This is the main entry point. The `operation` field in `params`
   * determines which sub-operation is performed. All errors — path
   * resolution, parameter validation, filesystem failures — are caught
   * and returned as `{ success: false }` results. This method never
   * throws.
   *
   * @param params - Operation parameters.
   * @returns A {@link FileEditResult} describing the outcome.
   */
  async edit(params: FileEditParams): Promise<FileEditResult> {
    const operation = (params.operation ?? "").trim().toLowerCase();
    try {
      const resolvedPath = this.resolvePath(params.path);
      switch (operation) {
        case "write":
          return await this.write(
            resolvedPath,
            params.content,
            params.overwrite ?? true,
            params.createParents ?? true,
          );
        case "append":
          return await this.append(
            resolvedPath,
            params.content,
            params.createParents ?? true,
          );
        case "replace":
          return await this.replace(
            resolvedPath,
            params.oldString,
            params.newString,
            params.replaceAll ?? false,
          );
        case "replace_lines":
          return await this.replaceLines(
            resolvedPath,
            params.content,
            params.startLine,
            params.endLine,
          );
        case "delete":
          return await this.delete(resolvedPath);
        default:
          return this.failure(
            operation,
            params.path,
            "Invalid operation. Use write, append, replace, replace_lines, or delete.",
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(operation, params.path, message);
    }
  }

  // ----------------------------------------------------------------
  // Operation methods
  // ----------------------------------------------------------------

  /**
   * Write content to a file.
   *
   * Steps:
   * 1. Validate that `content` is not `undefined`/`null`.
   * 2. Ensure the path is a valid file target (not a directory; create
   *    parent directories if needed).
   * 3. If `overwrite` is `false` and the file exists, fail.
   * 4. Write the content as UTF-8 without BOM.
   *
   * @param filePath - Resolved absolute file path.
   * @param content - Text content to write.
   * @param overwrite - Whether to overwrite an existing file.
   * @param createParents - Whether to create missing parent directories.
   * @returns The edit result.
   */
  private async write(
    filePath: string,
    content: string | undefined,
    overwrite: boolean,
    createParents: boolean,
  ): Promise<FileEditResult> {
    this.requireContent(content, "write");
    await this.ensureFileTarget(filePath, createParents);

    if (!overwrite) {
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat) {
        return this.failure(
          "write",
          filePath,
          "File already exists and overwrite is false.",
        );
      }
    }

    await fs.writeFile(filePath, content!, "utf8");
    const bytesWritten = Buffer.byteLength(content!, "utf8");
    return {
      success: true,
      operation: "write",
      path: filePath,
      bytesWritten,
      message: "File written.",
    };
  }

  /**
   * Append content to the end of a file.
   *
   * Steps:
   * 1. Validate that `content` is not `undefined`/`null`.
   * 2. Ensure the path is a valid file target (not a directory; create
   *    parent directories if needed).
   * 3. Append the content as UTF-8 without BOM. The file is created if
   *    it does not exist.
   *
   * @param filePath - Resolved absolute file path.
   * @param content - Text content to append.
   * @param createParents - Whether to create missing parent directories.
   * @returns The edit result.
   */
  private async append(
    filePath: string,
    content: string | undefined,
    createParents: boolean,
  ): Promise<FileEditResult> {
    this.requireContent(content, "append");
    await this.ensureFileTarget(filePath, createParents);

    await fs.appendFile(filePath, content!, "utf8");
    const bytesWritten = Buffer.byteLength(content!, "utf8");
    return {
      success: true,
      operation: "append",
      path: filePath,
      bytesWritten,
      message: "Content appended.",
    };
  }

  /**
   * Find and replace text within a file.
   *
   * Steps:
   * 1. Ensure the file exists (and is not a directory).
   * 2. Validate `oldString` (must not be empty) and `newString` (must
   *    not be `undefined`/`null`; empty string is allowed).
   * 3. Read the file (stripping BOM if present).
   * 4. Replace the first or all occurrences of `oldString`.
   * 5. If no match is found, fail.
   * 6. Write the modified text back as UTF-8 without BOM.
   *
   * @param filePath - Resolved absolute file path.
   * @param oldString - Text to find.
   * @param newString - Replacement text.
   * @param replaceAll - Whether to replace all occurrences.
   * @returns The edit result.
   */
  private async replace(
    filePath: string,
    oldString: string | undefined,
    newString: string | undefined,
    replaceAll: boolean,
  ): Promise<FileEditResult> {
    await this.ensureExistingFile(filePath);

    if (!oldString) {
      return this.failure(
        "replace",
        filePath,
        "oldString is required and must not be empty.",
      );
    }
    if (newString === undefined || newString === null) {
      return this.failure(
        "replace",
        filePath,
        "newString is required. Use an empty string to remove text.",
      );
    }

    const original = await this.readTextFile(filePath);
    const { result, replacements } = this.replaceText(
      original,
      oldString,
      newString,
      replaceAll,
    );

    if (replacements === 0) {
      return this.failure("replace", filePath, "oldString was not found.");
    }

    await fs.writeFile(filePath, result, "utf8");
    return {
      success: true,
      operation: "replace",
      path: filePath,
      replacements,
      bytesWritten: Buffer.byteLength(result, "utf8"),
      message: "Text replaced.",
    };
  }

  /**
   * Replace a range of lines within a file.
   *
   * Steps:
   * 1. Ensure the file exists (and is not a directory).
   * 2. Validate `content` (must not be `undefined`/`null`).
   * 3. Validate `startLine` (must be >= 1) and `endLine` (defaults to
   *    `startLine`, must be >= `startLine`).
   * 4. Parse the file with {@link LineDocument} to preserve the original
   *    newline style and trailing-newline convention.
   * 5. Validate that `startLine` and `endLine` do not exceed the file's
   *    line count.
   * 6. Split `content` into lines and splice them into the document,
   *    replacing the inclusive range `[startLine, endLine]`.
   * 7. Render and write back as UTF-8 without BOM.
   *
   * @param filePath - Resolved absolute file path.
   * @param content - Replacement text (split into lines).
   * @param startLine - 1-based inclusive start line.
   * @param endLine - 1-based inclusive end line (defaults to `startLine`).
   * @returns The edit result.
   */
  private async replaceLines(
    filePath: string,
    content: string | undefined,
    startLine: number | undefined,
    endLine: number | undefined,
  ): Promise<FileEditResult> {
    await this.ensureExistingFile(filePath);
    this.requireContent(content, "replace_lines");

    if (startLine === undefined || startLine < 1) {
      return this.failure(
        "replace_lines",
        filePath,
        "startLine is required and must be greater than 0.",
      );
    }

    const effectiveEndLine = endLine ?? startLine;
    if (effectiveEndLine < startLine) {
      return this.failure(
        "replace_lines",
        filePath,
        "endLine must be greater than or equal to startLine.",
      );
    }

    const original = await this.readTextFile(filePath);
    const doc = LineDocument.parse(original);

    if (startLine > doc.lines.length) {
      return this.failure(
        "replace_lines",
        filePath,
        "startLine is beyond the end of the file.",
      );
    }
    if (effectiveEndLine > doc.lines.length) {
      return this.failure(
        "replace_lines",
        filePath,
        "endLine is beyond the end of the file.",
      );
    }

    const newLines = LineDocument.splitContentLines(content!);
    const replacedCount = effectiveEndLine - startLine + 1;

    // Replace the inclusive range [startLine, endLine] (1-based) with
    // the new lines. Array.splice(start, deleteCount, ...items) is
    // equivalent to the C# RemoveRange + InsertRange pattern.
    doc.lines.splice(startLine - 1, replacedCount, ...newLines);

    const result = doc.render();
    await fs.writeFile(filePath, result, "utf8");

    return {
      success: true,
      operation: "replace_lines",
      path: filePath,
      replacements: replacedCount,
      bytesWritten: Buffer.byteLength(result, "utf8"),
      message: "Lines replaced.",
    };
  }

  /**
   * Delete a file.
   *
   * - Directories cannot be deleted (the operation fails with an error).
   * - The file must exist.
   *
   * @param filePath - Resolved absolute file path.
   * @returns The edit result.
   */
  private async delete(filePath: string): Promise<FileEditResult> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      return this.failure("delete", filePath, "File does not exist.");
    }
    if (stat.isDirectory()) {
      return this.failure(
        "delete",
        filePath,
        "Path is a directory. file_edit delete only removes files and does not delete directories.",
      );
    }

    await fs.unlink(filePath);
    return {
      success: true,
      operation: "delete",
      path: filePath,
      message: "File deleted.",
    };
  }

  // ----------------------------------------------------------------
  // Helper methods
  // ----------------------------------------------------------------

  /**
   * Resolve and validate a path using the internal {@link PathResolver}.
   *
   * @param filePath - The path to resolve (absolute or relative).
   * @returns The absolute, normalized file path.
   * @throws {Error} When the path is empty, contains invalid characters,
   *                 is drive-relative, or points to a directory.
   */
  private resolvePath(filePath: string): string {
    return this.pathResolver.resolve(filePath);
  }

  /**
   * Ensure the path is a valid file target for write/append operations.
   *
   * Checks performed:
   * 1. If the path points to an existing **directory**, throw.
   * 2. Determine the parent directory via `path.dirname`.
   * 3. If the parent directory does not exist:
   *    - When `createParents` is `false`, throw.
   *    - When `createParents` is `true`, create the full parent tree
   *      with `fs.mkdir({ recursive: true })`.
   *
   * @param filePath - Resolved absolute file path.
   * @param createParents - Whether to create missing parent directories.
   * @throws {Error} When the path is a directory or the parent directory
   *                 does not exist and `createParents` is `false`.
   */
  private async ensureFileTarget(
    filePath: string,
    createParents: boolean,
  ): Promise<void> {
    // Reject if the path is an existing directory
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.isDirectory()) {
      throw new Error("path points to an existing directory.");
    }

    const parentDir = path.dirname(filePath);
    if (!parentDir) {
      throw new Error("path does not include a parent directory.");
    }

    // Check whether the parent directory already exists
    const parentStat = await fs.stat(parentDir).catch(() => null);
    if (!parentStat || !parentStat.isDirectory()) {
      if (!createParents) {
        throw new Error(
          "Parent directory does not exist and createParents is false.",
        );
      }
      await fs.mkdir(parentDir, { recursive: true });
    }
  }

  /**
   * Ensure the path points to an existing file.
   *
   * Checks performed:
   * 1. If the path does not exist (or is inaccessible), throw
   *    "File does not exist."
   * 2. If the path points to a directory, throw
   *    "path points to an existing directory."
   *
   * @param filePath - Resolved absolute file path.
   * @throws {Error} When the file does not exist or the path is a directory.
   */
  private async ensureExistingFile(filePath: string): Promise<void> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      throw new Error("File does not exist.");
    }
    if (stat.isDirectory()) {
      throw new Error("path points to an existing directory.");
    }
  }

  /**
   * Validate that content is provided (not `undefined` or `null`).
   *
   * An empty string is valid — this check only rejects missing content.
   * The error message advises the caller to use an empty string when
   * they intentionally want to write no text.
   *
   * @param content - The content to validate.
   * @param operation - The operation name (used in the error message).
   * @throws {Error} When `content` is `undefined` or `null`.
   */
  private requireContent(
    content: string | undefined,
    operation: string,
  ): void {
    if (content === undefined || content === null) {
      throw new Error(
        `content is required for ${operation}. Use an empty string when intentionally writing no text.`,
      );
    }
  }

  /**
   * Read a text file as UTF-8, stripping a leading BOM if present.
   *
   * This mirrors the C# `Encoding.UTF8` read behavior, which
   * automatically detects and removes a UTF-8 BOM (U+FEFF) from the
   * start of the file content.
   *
   * @param filePath - The file to read.
   * @returns The file content as a string (BOM stripped if present).
   */
  private async readTextFile(filePath: string): Promise<string> {
    let content = await fs.readFile(filePath, "utf8");
    // Strip UTF-8 BOM (U+FEFF) if present
    if (content.length > 0 && content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    return content;
  }

  /**
   * Replace occurrences of `oldString` with `newString` in `text`.
   *
   * Ported from the C# `ReplaceText` helper. Uses ordinal (byte-level)
   * string matching via `String.prototype.indexOf`, which is equivalent
   * to C#'s `StringComparison.Ordinal`.
   *
   * When `replaceAll` is `false`, only the first occurrence is replaced.
   * When `replaceAll` is `true`, all occurrences are replaced using a
   * manual scan that advances past each match — this correctly handles
   * cases where `newString` itself contains `oldString` (no infinite
   * loop).
   *
   * @param text - The original text.
   * @param oldString - The text to find.
   * @param newString - The replacement text.
   * @param replaceAll - If `true`, replace all occurrences; otherwise
   *                     replace only the first.
   * @returns An object with the `result` text and `replacements` count.
   */
  private replaceText(
    text: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
  ): { result: string; replacements: number } {
    text = text ?? "";
    let replacements = 0;

    const firstIndex = text.indexOf(oldString);
    if (firstIndex < 0) {
      return { result: text, replacements: 0 };
    }

    if (!replaceAll) {
      return {
        result:
          text.slice(0, firstIndex) +
          newString +
          text.slice(firstIndex + oldString.length),
        replacements: 1,
      };
    }

    // Replace all occurrences using a manual scan (avoids regex escaping
    // issues and matches the C# StringBuilder approach).
    const parts: string[] = [];
    let lastIndex = 0;
    let currentIndex = firstIndex;
    while (currentIndex >= 0) {
      parts.push(text.slice(lastIndex, currentIndex));
      parts.push(newString);
      lastIndex = currentIndex + oldString.length;
      replacements++;
      currentIndex = text.indexOf(oldString, lastIndex);
    }
    parts.push(text.slice(lastIndex));
    return { result: parts.join(""), replacements };
  }

  /**
   * Build a failure result.
   *
   * @param operation - The normalized operation name.
   * @param filePath - The file path (resolved or original).
   * @param message - The error message.
   * @returns A `FileEditResult` with `success: false`.
   */
  private failure(
    operation: string,
    filePath: string,
    message: string,
  ): FileEditResult {
    return {
      success: false,
      operation: operation ?? "",
      path: filePath ?? "",
      message: message ?? "Operation failed.",
    };
  }
}
