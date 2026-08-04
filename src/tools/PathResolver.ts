import * as path from "node:path";

/**
 * Characters that are always invalid in a path string.
 *
 * Mirrors the spirit of C# `Path.GetInvalidPathChars()`: ASCII control
 * characters (0x00–0x1F) plus `<`, `>`, `|`, and `"`.
 */
const INVALID_PATH_CHARS = /[\x00-\x1f<>|"]/;

/**
 * Matches a Windows drive-relative path such as `C:file.txt`.
 *
 * A single ASCII letter followed by `:` and then a character that is
 * **not** a path separator (`\` or `/`). Drive-relative paths are
 * ambiguous (they are relative to the current directory of the drive)
 * and are rejected for safety.
 */
const DRIVE_RELATIVE_PATTERN = /^[a-zA-Z]:[^\\/]/;

/**
 * Matches a Windows drive-absolute path such as `C:\file` or `C:/file`.
 *
 * Used as a cross-platform supplement to `path.isAbsolute` so that
 * Windows-style absolute paths are recognized even on POSIX hosts.
 */
const DRIVE_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;

/**
 * PathResolver — resolve and validate filesystem paths.
 *
 * Ported from the C# `PathResolver` class. Responsibilities:
 * - Resolve relative paths against a base directory.
 * - Accept absolute paths (Windows drive-absolute and root-relative).
 * - Validate path characters and reject ambiguous drive-relative paths.
 * - Normalize the result with `path.resolve`.
 * - Ensure the resolved path points to a file, not a directory.
 *
 * Path-traversal safety is provided by:
 * - Rejecting invalid characters.
 * - Rejecting drive-relative paths (e.g. `C:file.txt`).
 * - Normalizing via `path.resolve` so `..` segments are collapsed.
 *
 * For explicit base-directory containment checks, use
 * {@link PathResolver.contains}.
 *
 * @example
 * ```ts
 * const resolver = new PathResolver("C:\\projects\\app");
 * resolver.resolve("src/index.ts");
 * // -> "C:\\projects\\app\\src\\index.ts"
 *
 * resolver.resolve("C:\\other\\file.txt");
 * // -> "C:\\other\\file.txt"  (absolute paths are used directly)
 * ```
 */
export class PathResolver {
  /** The absolute, normalized base directory for resolving relative paths. */
  private readonly baseDir: string;

  /**
   * @param baseDir - Base directory used to resolve relative paths.
   *                  Resolved to an absolute path in the constructor.
   * @throws {Error} When `baseDir` is null or empty.
   */
  constructor(baseDir: string) {
    if (!baseDir) {
      throw new Error("Base directory cannot be null or empty.");
    }
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Resolve and validate a path.
   *
   * Steps:
   * 1. Reject empty input.
   * 2. Reject paths containing invalid characters.
   * 3. Reject Windows drive-relative paths (e.g. `C:file.txt`).
   * 4. Determine whether the path is absolute (Windows drive-absolute,
   *    root-relative, or per `path.isAbsolute`).
   * 5. Resolve: absolute paths are used directly; relative paths are
   *    joined with {@link baseDir}. `path.resolve` normalizes the result.
   * 6. Ensure the resolved path points to a file, not a directory.
   *
   * @param inputPath - The path to resolve (absolute or relative).
   * @returns The absolute, normalized path.
   * @throws {Error} When the path is empty, contains invalid characters,
   *                 is drive-relative, or points to a directory.
   */
  resolve(inputPath: string): string {
    // 1. Reject empty input
    if (!inputPath) {
      throw new Error("Path cannot be null or empty.");
    }

    // 2. Reject invalid path characters
    if (INVALID_PATH_CHARS.test(inputPath)) {
      throw new Error(`Path contains invalid characters: "${inputPath}"`);
    }

    // 3. Reject Windows drive-relative paths (e.g. "C:file.txt")
    if (DRIVE_RELATIVE_PATTERN.test(inputPath)) {
      throw new Error(
        `Drive-relative paths are not allowed: "${inputPath}". ` +
          'Use an absolute path such as "C:\\folder\\file.txt" instead.',
      );
    }

    // 4. Determine absolute vs relative
    const isAbsolute =
      DRIVE_ABSOLUTE_PATTERN.test(inputPath) || path.isAbsolute(inputPath);

    // 5. Resolve and normalize
    const resolved = isAbsolute
      ? path.resolve(inputPath)
      : path.resolve(this.baseDir, inputPath);

    // 6. Ensure the path points to a file, not a directory
    this.ensureIsFilePath(resolved, inputPath);

    return resolved;
  }

  /**
   * Check whether `target` is contained within `dir` (inclusive).
   *
   * Both paths should be absolute and normalized (use `path.resolve`).
   * Returns `true` when `target` equals `dir` or is a descendant of it.
   *
   * Note: Node's `path` module is case-sensitive even on Windows. If `dir`
   * and `target` use different casing for the same directory, this check
   * may return `false`. Ensure consistent casing for reliable results.
   *
   * @param dir - The candidate containing directory (absolute).
   * @param target - The path to test (absolute).
   * @returns `true` when `target` is inside `dir`.
   */
  static contains(dir: string, target: string): boolean {
    const rel = path.relative(dir, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  /**
   * Ensure a resolved path represents a file rather than a directory.
   *
   * Checks performed (without filesystem access):
   * - The original path must not end with a path separator.
   * - The resolved path must have a non-empty basename.
   *
   * @param resolved - The normalized absolute path.
   * @param original - The original input path (for separator check).
   * @throws {Error} When the path appears to point to a directory.
   */
  private ensureIsFilePath(resolved: string, original: string): void {
    // A trailing separator in the input signals directory intent.
    if (/[\\/]$/.test(original)) {
      throw new Error(
        `Path must point to a file, not a directory: "${original}"`,
      );
    }
    // Root paths (e.g. "/" or "C:\") have an empty basename.
    if (path.basename(resolved).length === 0) {
      throw new Error(
        `Path must point to a file, not a directory: "${resolved}"`,
      );
    }
  }
}
