import * as path from "node:path";
import * as pathWin from "node:path/win32";
import * as pathPosix from "node:path/posix";

/**
 * Characters that are always invalid in a path string.
 *
 * Mirrors the spirit of C# `Path.GetInvalidPathChars()`: ASCII control
 * characters (0x00–0x1F) plus `<`, `>`, `|`, and `"`.
 */
// eslint-disable-next-line no-control-regex -- control chars are intentionally checked here (mirrors C# Path.GetInvalidPathChars)
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
 * Determine the appropriate path module for a given input.
 *
 * - Windows drive-absolute paths (e.g. `C:\folder`) always use `path.win32`
 *   so they are parsed correctly on any host.
 * - POSIX absolute paths (e.g. `/home/user`) always use `path.posix`.
 * - Relative paths use the host's native path module.
 */
function pathFor(p: string): path.PlatformPath {
  if (DRIVE_ABSOLUTE_PATTERN.test(p)) {
    return pathWin;
  }
  // Check for POSIX absolute path
  if (p.startsWith("/")) {
    return pathPosix;
  }
  // Relative path — use host platform
  return path;
}

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
 * Cross-platform support:
 * - Windows drive-absolute paths (e.g. `C:\folder\file`) are recognized
 *   on any platform using `path.win32`.
 * - POSIX absolute paths (e.g. `/home/user/file`) are recognized on any
 *   platform using `path.posix`.
 * - Relative paths are resolved using the host platform's path module.
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
 * // -> "C:\\projects\\app\\src\\index.ts"  (on Windows)
 *
 * resolver.resolve("C:\\other\\file.txt");
 * // -> "C:\\other\\file.txt"  (absolute paths are used directly)
 * ```
 */
export class PathResolver {
  /** The absolute, normalized base directory for resolving relative paths. */
  private readonly baseDir: string;
  /** The path module used for the base directory (win32 or posix). */
  private readonly basePlatform: path.PlatformPath;

  /**
   * @param baseDir - Base directory used to resolve relative paths.
   *                  Resolved to an absolute path in the constructor.
   * @throws {Error} When `baseDir` is null or empty.
   */
  constructor(baseDir: string) {
    if (!baseDir) {
      throw new Error("Base directory cannot be null or empty.");
    }
    // Detect the platform style of baseDir for relative path resolution
    this.basePlatform = pathFor(baseDir);
    this.baseDir = this.basePlatform.resolve(baseDir);
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

    // 4. Select the appropriate path module for this input
    const p = pathFor(inputPath);

    // 5. Determine absolute vs relative
    const isAbsolute =
      DRIVE_ABSOLUTE_PATTERN.test(inputPath) || p.isAbsolute(inputPath);

    // 6. Resolve and normalize
    // For relative paths, use the base directory's platform module
    // so that Windows base dirs resolve correctly on POSIX hosts.
    const resolveModule = isAbsolute ? p : this.basePlatform;
    const resolved = isAbsolute
      ? resolveModule.resolve(inputPath)
      : resolveModule.resolve(this.baseDir, inputPath);

    // 7. Ensure the path points to a file, not a directory
    this.ensureIsFilePath(resolved, inputPath);

    return resolved;
  }

  /**
   * Check whether `target` is contained within `dir` (inclusive).
   *
   * Both paths should be absolute and normalized (use `path.resolve`).
   * Returns `true` when `target` equals `dir` or is a descendant of it.
   *
   * Uses the appropriate path module (win32 or posix) based on the
   * directory's path style, ensuring correct containment checks
   * across platforms.
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
    const p = pathFor(dir);
    const rel = p.relative(dir, target);
    return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
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
    const p = pathFor(resolved);
    if (p.basename(resolved).length === 0) {
      throw new Error(
        `Path must point to a file, not a directory: "${resolved}"`,
      );
    }
  }
}
