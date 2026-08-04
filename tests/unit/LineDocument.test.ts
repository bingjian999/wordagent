import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { LineDocument } from "../../src/tools/LineDocument.js";

describe("LineDocument", () => {
  describe("parse", () => {
    it("should parse LF newlines into lines", () => {
      const doc = LineDocument.parse("a\nb\nc");
      assert.deepEqual(doc.lines, ["a", "b", "c"]);
      assert.equal(doc.newline, "\n");
      assert.equal(doc.trailingNewline, false);
    });

    it("should parse CRLF newlines and detect \\r\\n", () => {
      const doc = LineDocument.parse("a\r\nb\r\nc");
      assert.deepEqual(doc.lines, ["a", "b", "c"]);
      assert.equal(doc.newline, "\r\n");
      assert.equal(doc.trailingNewline, false);
    });

    it("should detect a trailing newline", () => {
      const doc = LineDocument.parse("a\nb\n");
      assert.deepEqual(doc.lines, ["a", "b"]);
      assert.equal(doc.trailingNewline, true);
    });

    it("should parse empty text into a single empty line", () => {
      const doc = LineDocument.parse("");
      assert.deepEqual(doc.lines, [""]);
      assert.equal(doc.trailingNewline, false);
      assert.equal(doc.newline, os.EOL);
    });

    it("should parse a single newline as one empty line with trailing newline", () => {
      const doc = LineDocument.parse("\n");
      assert.deepEqual(doc.lines, [""]);
      assert.equal(doc.trailingNewline, true);
      assert.equal(doc.newline, "\n");
    });

    it("should detect \\r\\n when newlines are mixed", () => {
      const doc = LineDocument.parse("a\r\nb\nc");
      assert.equal(doc.newline, "\r\n");
      assert.deepEqual(doc.lines, ["a", "b", "c"]);
      assert.equal(doc.trailingNewline, false);
    });

    it("should parse CR-only newlines", () => {
      const doc = LineDocument.parse("a\rb\rc");
      assert.equal(doc.newline, "\r");
      assert.deepEqual(doc.lines, ["a", "b", "c"]);
      assert.equal(doc.trailingNewline, false);
    });

    it("should parse a single line without any newline", () => {
      const doc = LineDocument.parse("hello");
      assert.deepEqual(doc.lines, ["hello"]);
      assert.equal(doc.trailingNewline, false);
      assert.equal(doc.newline, os.EOL);
    });
  });

  describe("render", () => {
    it("should render LF text unchanged", () => {
      const text = "a\nb\nc";
      const doc = LineDocument.parse(text);
      assert.equal(doc.render(), text);
    });

    it("should render CRLF text unchanged", () => {
      const text = "a\r\nb\r\nc";
      const doc = LineDocument.parse(text);
      assert.equal(doc.render(), text);
    });

    it("should render a trailing newline when present", () => {
      const doc = LineDocument.parse("a\nb\n");
      assert.equal(doc.render(), "a\nb\n");
    });

    it("should reflect mutated lines after editing the array", () => {
      const doc = LineDocument.parse("a\nb\nc");
      doc.lines.push("d");
      assert.equal(doc.render(), "a\nb\nc\nd");
      doc.lines[0] = "x";
      assert.equal(doc.render(), "x\nb\nc\nd");
    });
  });

  describe("splitContentLines", () => {
    it("should split LF content into lines", () => {
      assert.deepEqual(LineDocument.splitContentLines("a\nb\nc"), [
        "a",
        "b",
        "c",
      ]);
    });

    it("should return a single empty string for empty content", () => {
      assert.deepEqual(LineDocument.splitContentLines(""), [""]);
    });

    it("should normalize CRLF when splitting", () => {
      assert.deepEqual(LineDocument.splitContentLines("a\r\nb"), ["a", "b"]);
    });

    it("should keep the trailing empty segment produced by a final newline", () => {
      assert.deepEqual(LineDocument.splitContentLines("a\nb\n"), [
        "a",
        "b",
        "",
      ]);
    });
  });
});
