import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanHtml,
  extractTitle,
  normalizeWhitespace,
  extractReadableText,
  decodeBytes,
} from "../../src/tools/HtmlCleaner.js";

describe("cleanHtml", () => {
  it("基本清洗：移除 HTML 标签", () => {
    const html = "<p>Hello World</p>";
    const result = cleanHtml(html);
    assert.equal(result, "Hello World");
  });

  it("移除 script 标签及其内容", () => {
    const html = "<script>alert('xss')</script>Hello";
    const result = cleanHtml(html);
    assert.equal(result, "Hello");
  });

  it("移除 style 标签及其内容", () => {
    const html = "<style>body { color: red; }</style>Hello";
    const result = cleanHtml(html);
    assert.equal(result, "Hello");
  });

  it("移除 HTML 注释", () => {
    const html = "<!-- this is a comment -->Hello";
    const result = cleanHtml(html);
    assert.equal(result, "Hello");
  });

  it("块级标签转换为换行（<p>, <div>, <br>）", () => {
    // <p> 标签：两个段落之间产生空行
    assert.equal(cleanHtml("<p>Line1</p><p>Line2</p>"), "Line1\n\nLine2");
    // <div> 标签
    assert.equal(cleanHtml("<div>A</div><div>B</div>"), "A\n\nB");
    // <br> 标签：单行换行
    assert.equal(cleanHtml("Line1<br>Line2"), "Line1\nLine2");
  });

  it("HTML 实体解码（&amp; → &, &lt; → <, &gt; → >）", () => {
    const html = "&amp;&lt;&gt;";
    const result = cleanHtml(html);
    assert.equal(result, "&<>");
  });

  it("空输入返回空字符串", () => {
    assert.equal(cleanHtml(""), "");
  });
});

describe("extractTitle", () => {
  it("提取 <title> 标签内容", () => {
    const html = "<html><head><title>Test Page</title></head></html>";
    const result = extractTitle(html);
    assert.equal(result, "Test Page");
  });

  it("无 <title> 标签时返回空字符串", () => {
    const html = "<html><body>No title here</body></html>";
    const result = extractTitle(html);
    assert.equal(result, "");
  });
});

describe("normalizeWhitespace", () => {
  it("多个空格归一化为单个空格", () => {
    const result = normalizeWhitespace("hello    world");
    assert.equal(result, "hello world");
  });

  it("\\r\\n 归一化为 \\n", () => {
    const result = normalizeWhitespace("hello\r\nworld");
    assert.equal(result, "hello\nworld");
  });

  it("连续换行限制为最多两个", () => {
    const result = normalizeWhitespace("a\n\n\n\nb");
    assert.equal(result, "a\n\nb");
  });
});

describe("extractReadableText", () => {
  it("HTML 类型：提取标题和清洗后的正文", () => {
    const contentType = "text/html; charset=utf-8";
    const bytes = Buffer.from(
      "<html><head><title>My Title</title></head><body><p>Hello HTML</p></body></html>",
      "utf-8",
    );
    const result = extractReadableText(contentType, bytes, 1000);
    assert.equal(result.title, "My Title");
    assert.equal(result.text, "My Title\nHello HTML");
    assert.equal(result.truncated, false);
  });

  it("纯文本类型：归一化空白字符", () => {
    const contentType = "text/plain; charset=utf-8";
    const bytes = Buffer.from("Hello    World", "utf-8");
    const result = extractReadableText(contentType, bytes, 1000);
    assert.equal(result.text, "Hello World");
    assert.equal(result.title, "");
    assert.equal(result.truncated, false);
  });

  it("截断测试：超出 maxChars 时截断并标记 truncated", () => {
    const contentType = "text/plain; charset=utf-8";
    const bytes = Buffer.from("Hello World", "utf-8");
    const result = extractReadableText(contentType, bytes, 5);
    assert.equal(result.text, "Hello");
    assert.equal(result.truncated, true);
  });
});

describe("decodeBytes", () => {
  it("UTF-8 解码（含多字节字符）", () => {
    const contentType = "text/html; charset=utf-8";
    const bytes = Buffer.from("Hello 世界", "utf-8");
    const result = decodeBytes(contentType, bytes);
    assert.equal(result, "Hello 世界");
  });

  it("从 Content-Type 提取 charset 进行解码（UTF-16LE）", () => {
    const contentType = "text/html; charset=utf-16le";
    const bytes = Buffer.from("Hello", "utf16le");
    const result = decodeBytes(contentType, bytes);
    assert.equal(result, "Hello");
  });
});
