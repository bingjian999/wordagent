import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PathResolver } from "../../src/tools/PathResolver.js";

/**
 * Cross-platform test suite for PathResolver.
 *
 * Tests adapt to the host platform:
 * - On Windows (win32): uses Windows-style paths (C:\projects\app)
 * - On POSIX (Linux/macOS): uses POSIX-style paths (/tmp/projects/app)
 *
 * Additional tests verify that Windows-style paths are correctly
 * resolved even on POSIX hosts (cross-platform path detection).
 */

const isWindows = process.platform === "win32";

// Platform-native paths
const BASE_DIR = isWindows ? "C:\\projects\\app" : "/tmp/projects/app";
const SEP = isWindows ? "\\" : "/";
const OTHER_DRIVE = isWindows ? "D:\\other\\file.txt" : "/var/other/file.txt";

// Expected resolution helper
function expectedBase(...parts: string[]): string {
  return [BASE_DIR, ...parts].join(SEP);
}

function makeResolver(): PathResolver {
  return new PathResolver(BASE_DIR);
}

describe("PathResolver", () => {
  describe("constructor", () => {
    it("should reject an empty baseDir", () => {
      assert.throws(() => new PathResolver(""), /null or empty/i);
    });

    it("should reject a null baseDir", () => {
      assert.throws(
        () => new PathResolver(null as unknown as string),
        /null or empty/i,
      );
    });
  });

  describe("resolve", () => {
    it("should resolve an absolute path as-is", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve(OTHER_DRIVE),
        OTHER_DRIVE,
      );
    });

    it("should resolve a relative path against baseDir", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("file.txt"),
        expectedBase("file.txt"),
      );
    });

    it("should resolve a relative subdirectory path", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("sub/file.txt"),
        expectedBase("sub", "file.txt"),
      );
    });

    it("should reject an empty path", () => {
      const resolver = makeResolver();
      assert.throws(() => resolver.resolve(""), /null or empty/i);
    });

    it("should reject paths containing control characters", () => {
      const resolver = makeResolver();
      assert.throws(
        () => resolver.resolve("file\x00.txt"),
        /invalid characters/i,
      );
    });

    it("should reject Windows drive-relative paths", () => {
      const resolver = makeResolver();
      assert.throws(
        () => resolver.resolve("C:file.txt"),
        /drive-relative/i,
      );
    });

    it("should resolve ../ paths that escape above baseDir", () => {
      const resolver = makeResolver();
      const expected = isWindows
        ? "C:\\projects\\file.txt"
        : "/tmp/projects/file.txt";
      assert.equal(
        resolver.resolve("../file.txt"),
        expected,
      );
    });

    it("should resolve paths with a ./ prefix", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("./file.txt"),
        expectedBase("file.txt"),
      );
    });

    it("should reject paths that point to a directory (trailing slash)", () => {
      const resolver = makeResolver();
      assert.throws(() => resolver.resolve("sub/"), /file, not a directory/i);
    });

    it("should reject paths that point to a directory (trailing backslash)", () => {
      const resolver = makeResolver();
      assert.throws(
        () => resolver.resolve("sub\\"),
        /file, not a directory/i,
      );
    });

    it("should normalize ../ segments within a path", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("sub/../file.txt"),
        expectedBase("file.txt"),
      );
    });

    it("should handle platform-native separators", () => {
      const resolver = makeResolver();
      const relPath = isWindows ? "sub\\file.txt" : "sub/file.txt";
      assert.equal(
        resolver.resolve(relPath),
        expectedBase("sub", "file.txt"),
      );
    });
  });

  describe("contains", () => {
    it("should return true for a descendant path", () => {
      const base = isWindows ? "C:\\base" : "/tmp/base";
      const descendant = isWindows ? "C:\\base\\sub\\file" : "/tmp/base/sub/file";
      assert.equal(
        PathResolver.contains(base, descendant),
        true,
      );
    });

    it("should return false for a path outside the directory", () => {
      const base = isWindows ? "C:\\base" : "/tmp/base";
      const outside = isWindows ? "C:\\other\\path" : "/var/other/path";
      assert.equal(
        PathResolver.contains(base, outside),
        false,
      );
    });

    it("should return true when the target equals the directory", () => {
      const base = isWindows ? "C:\\base" : "/tmp/base";
      assert.equal(PathResolver.contains(base, base), true);
    });
  });

  describe("cross-platform path handling", () => {
    it("should correctly resolve Windows drive paths on any platform", () => {
      // Windows drive-absolute paths should be recognized on all platforms
      const resolver = new PathResolver("C:\\projects\\app");
      assert.equal(
        resolver.resolve("C:\\folder\\file.txt"),
        "C:\\folder\\file.txt",
      );
    });

    it("should correctly resolve relative paths against Windows base dir on any platform", () => {
      const resolver = new PathResolver("C:\\projects\\app");
      assert.equal(
        resolver.resolve("file.txt"),
        "C:\\projects\\app\\file.txt",
      );
    });

    it("should handle Windows backslash separators in relative paths with Windows base", () => {
      const resolver = new PathResolver("C:\\projects\\app");
      assert.equal(
        resolver.resolve("sub\\file.txt"),
        "C:\\projects\\app\\sub\\file.txt",
      );
    });

    it("should correctly resolve POSIX paths on any platform", () => {
      const resolver = new PathResolver("/tmp/projects/app");
      assert.equal(
        resolver.resolve("/var/other/file.txt"),
        "/var/other/file.txt",
      );
    });

    it("should correctly resolve relative paths against POSIX base dir on any platform", () => {
      const resolver = new PathResolver("/tmp/projects/app");
      assert.equal(
        resolver.resolve("file.txt"),
        "/tmp/projects/app/file.txt",
      );
    });

    it("should detect containment for Windows paths on any platform", () => {
      assert.equal(
        PathResolver.contains("C:\\base", "C:\\base\\sub\\file"),
        true,
      );
      assert.equal(
        PathResolver.contains("C:\\base", "C:\\other\\path"),
        false,
      );
    });

    it("should detect containment for POSIX paths on any platform", () => {
      assert.equal(
        PathResolver.contains("/tmp/base", "/tmp/base/sub/file"),
        true,
      );
      assert.equal(
        PathResolver.contains("/tmp/base", "/var/other/path"),
        false,
      );
    });
  });
});
