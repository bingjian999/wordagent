import * as crypto from "node:crypto";

/**
 * File Intelligence Service
 *
 * Provides file analysis capabilities:
 * - SHA-256 hash calculation for deduplication and integrity
 * - Text encoding detection (UTF-8, ASCII, etc.)
 * - Preview generation (first N chars, binary detection)
 * - MIME type detection from file content
 *
 * This layer is independent from storage — it operates on Buffers.
 */

/** Result of file analysis */
export interface FileAnalysis {
  /** SHA-256 hash hex string */
  hash: string;
  /** Detected encoding (utf-8, ascii, binary) */
  encoding: string;
  /** MIME type guess */
  mimeType: string;
  /** Text preview (first 500 chars for text files, null for binary) */
  preview: string | null;
  /** Whether the file is likely text */
  isText: boolean;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "csv", "tsv", "xml", "yaml", "yml",
  "js", "ts", "py", "rb", "go", "rs", "java", "c", "cpp", "h",
  "html", "css", "scss", "sql", "sh", "bat", "ps1", "log",
]);

const MIME_MAP: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xml: "application/xml",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/typescript",
};

export class FileIntelligenceService {
  /**
   * Analyze a file buffer and return metadata.
   */
  analyze(buffer: Buffer, filename: string): FileAnalysis {
    const ext = this.getExtension(filename);
    const hash = this.calculateHash(buffer);
    const isText = this.detectIsText(buffer, ext);
    const encoding = isText ? this.detectEncoding(buffer) : "binary";
    const mimeType = this.detectMime(buffer, ext);
    const preview = isText ? this.generatePreview(buffer) : null;

    return { hash, encoding, mimeType, preview, isText };
  }

  /**
   * Calculate SHA-256 hash of file content.
   */
  calculateHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Get file extension (lowercase, without dot).
   */
  getExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === filename.length - 1) return "";
    return filename.substring(dotIndex + 1).toLowerCase();
  }

  /**
   * Detect if a file is likely text by checking for null bytes
   * and the ratio of printable characters.
   */
  detectIsText(buffer: Buffer, ext: string): boolean {
    // Known text extensions — fast path
    if (TEXT_EXTENSIONS.has(ext)) return true;

    // Empty file — treat as text
    if (buffer.length === 0) return true;

    // Check first 8KB for null bytes (strong binary indicator)
    const sampleSize = Math.min(buffer.length, 8192);
    const sample = buffer.subarray(0, sampleSize);

    // If null bytes present, likely binary
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return false;
    }

    // Check ratio of printable characters
    let printable = 0;
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      // Printable: tab(9), LF(10), CR(13), space(32), printable ASCII(32-126), UTF-8 multi-byte(128-255)
      if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) {
        printable++;
      }
    }

    return printable / sampleSize > 0.85;
  }

  /**
   * Detect text encoding by examining BOM and byte patterns.
   */
  detectEncoding(buffer: Buffer): string {
    if (buffer.length === 0) return "utf-8";

    // Check BOM markers
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return "utf-8-bom";
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return "utf-16le";
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      return "utf-16be";
    }

    // Check if pure ASCII
    let isAscii = true;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] > 127) {
        isAscii = false;
        break;
      }
    }
    if (isAscii) return "ascii";

    // Default to UTF-8 (validate by attempting to decode)
    try {
      buffer.toString("utf-8");
      // Basic UTF-8 validation — check for replacement chars
      const decoded = buffer.toString("utf-8");
      if (!decoded.includes("\uFFFD")) return "utf-8";
    } catch {
      // fall through
    }

    return "latin1";
  }

  /**
   * Detect MIME type from file extension and magic bytes.
   */
  detectMime(buffer: Buffer, ext: string): string {
    // Check magic bytes first
    if (buffer.length >= 4) {
      // PDF
      if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return "application/pdf";
      }
      // PNG
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return "image/png";
      }
      // JPEG (FFD8)
      if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        return "image/jpeg";
      }
      // GIF
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return "image/gif";
      }
      // ZIP-based (DOCX, XLSX)
      if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03) {
        if (ext === "docx") return MIME_MAP["docx"];
        if (ext === "xlsx") return MIME_MAP["xlsx"];
        return "application/zip";
      }
    }

    // Fall back to extension mapping
    return MIME_MAP[ext] ?? "application/octet-stream";
  }

  /**
   * Generate a text preview (first 500 characters).
   */
  generatePreview(buffer: Buffer): string | null {
    if (buffer.length === 0) return "";

    const sampleSize = Math.min(buffer.length, 2048); // Read up to 2KB
    const sample = buffer.subarray(0, sampleSize);
    const text = sample.toString("utf-8");

    // Clean up: replace excessive whitespace
    const cleaned = text.replace(/\r\n/g, "\n").replace(/\t/g, "  ");

    // Truncate to 500 chars
    if (cleaned.length <= 500) return cleaned;
    return cleaned.substring(0, 497) + "...";
  }
}
