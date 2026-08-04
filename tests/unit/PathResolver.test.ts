import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PathResolver } from "../../src/tools/PathResolver.js";

const BASE_DIR = "C:\\projects\\app";

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
    it("should resolve an absolute Windows path as-is", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("C:\\folder\\file.txt"),
        "C:\\folder\\file.txt",
      );
    });

    it("should resolve a relative path against baseDir", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("file.txt"),
        "C:\\projects\\app\\file.txt",
      );
    });

    it("should resolve a relative subdirectory path", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("sub/file.txt"),
        "C:\\projects\\app\\sub\\file.txt",
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
      assert.equal(
        resolver.resolve("../file.txt"),
        "C:\\projects\\file.txt",
      );
    });

    it("should resolve paths with a ./ prefix", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("./file.txt"),
        "C:\\projects\\app\\file.txt",
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
        "C:\\projects\\app\\file.txt",
      );
    });

    it("should handle Windows backslash separators", () => {
      const resolver = makeResolver();
      assert.equal(
        resolver.resolve("sub\\file.txt"),
        "C:\\projects\\app\\sub\\file.txt",
      );
    });
  });

  describe("contains", () => {
    it("should return true for a descendant path", () => {
      assert.equal(
        PathResolver.contains("C:\\base", "C:\\base\\sub\\file"),
        true,
      );
    });

    it("should return false for a path outside the directory", () => {
      assert.equal(
        PathResolver.contains("C:\\base", "C:\\other\\path"),
        false,
      );
    });

    it("should return true when the target equals the directory", () => {
      assert.equal(PathResolver.contains("C:\\base", "C:\\base"), true);
    });
  });
});
