/**
 * DocxService — Word document parsing and generation service.
 *
 * Provides two core capabilities:
 * 1. **Parse** — Extract text content from .docx files using `mammoth`.
 * 2. **Generate** — Create .docx files programmatically using the `docx` library.
 *
 * Designed for financial/accounting document scenarios: generating reports,
 * extracting text from uploaded Word documents, and creating structured
 * documents with headings, paragraphs, tables, and styling.
 *
 * @module DocxService
 */

import mammoth from "mammoth";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Result } from "../../domain/attachment/Result.js";
import { ok, err } from "../../domain/attachment/Result.js";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** Result of parsing a .docx file. */
export interface DocxParseResult {
  /** Extracted plain text content. */
  text: string;
  /** Extracted HTML content (preserves basic formatting). */
  html: string;
  /** Any warnings or info messages from the parser. */
  messages: string[];
  /** Number of characters extracted. */
  charCount: number;
}

/** Paragraph specification for document generation. */
export interface ParagraphSpec {
  /** Text content of the paragraph. */
  text: string;
  /** Paragraph style / heading level. */
  heading?: "Title" | "Heading1" | "Heading2" | "Heading3" | "normal";
  /** Bold text. */
  bold?: boolean;
  /** Italic text. */
  italic?: boolean;
  /** Text alignment. */
  alignment?: "left" | "center" | "right" | "justify";
  /** Bullet point list item. */
  bullet?: boolean;
  /** Font size in points (default 11). */
  fontSize?: number;
}

/** Table specification for document generation. */
export interface TableSpec {
  /** Table rows, each row is an array of cell texts. */
  rows: string[][];
  /** Whether the first row is a header row (bold, shaded). */
  headerRow?: boolean;
  /** Column widths in percentages (must sum to 100). Optional. */
  columnWidths?: number[];
}

/** Complete document content specification. */
export interface DocxContent {
  /** Document title (optional, placed at the top). */
  title?: string;
  /** Paragraphs in the document body. */
  paragraphs: ParagraphSpec[];
  /** Tables in the document body. */
  tables?: TableSpec[];
  /** Document creator name (metadata). */
  creator?: string;
  /** Document description (metadata). */
  description?: string;
}

/** Result of generating a .docx file. */
export interface DocxGenerateResult {
  /** Path to the generated file (if saved to disk). */
  filePath?: string;
  /** Generated file buffer (if not saved to disk). */
  buffer: Buffer;
  /** File size in bytes. */
  size: number;
}

// ------------------------------------------------------------------
// DocxService
// ------------------------------------------------------------------

/**
 * Service for parsing and generating Word (.docx) documents.
 *
 * @example Parse a .docx file
 * ```ts
 * const service = new DocxService();
 * const buffer = await fs.readFile("report.docx");
 * const result = await service.parse(buffer);
 * if (result.ok) {
 *   console.log(result.value.text);
 * }
 * ```
 *
 * @example Generate a .docx file
 * ```ts
 * const service = new DocxService();
 * const result = await service.generate({
 *   title: "Q1 Report",
 *   paragraphs: [
 *     { text: "Revenue Summary", heading: "Heading1" },
 *     { text: "Total revenue: ¥1,234,567" },
 *   ],
 *   tables: [{
 *     rows: [["Item", "Amount"], ["Revenue", "1,234,567"], ["Cost", "987,654"]],
 *     headerRow: true,
 *   }],
 * });
 * if (result.ok) {
 *   await fs.writeFile("report.docx", result.value.buffer);
 * }
 * ```
 */
export class DocxService {
  /**
   * Parse a .docx file buffer and extract text and HTML content.
   *
   * Uses `mammoth` for robust extraction, preserving basic formatting
   * (headings, bold, italic, lists) in the HTML output.
   *
   * @param buffer - .docx file content as a Buffer.
   * @returns Parsed result with text, HTML, and any parser messages.
   */
  async parse(buffer: Buffer): Promise<Result<DocxParseResult>> {
    try {
      // mammoth Node.js version accepts `buffer` (Buffer), not `arrayBuffer`
      const result = await mammoth.convertToHtml({ buffer });

      const text = await mammoth.extractRawText({ buffer });

      const messages = result.messages.map((m: { message: string }) => m.message);

      return ok({
        text: text.value,
        html: result.value,
        messages,
        charCount: text.value.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Failed to parse .docx: ${message}`);
    }
  }

  /**
   * Parse a .docx file from the filesystem.
   *
   * @param filePath - Path to the .docx file.
   * @returns Parsed result.
   */
  async parseFile(filePath: string): Promise<Result<DocxParseResult>> {
    try {
      const buffer = await fs.readFile(filePath);
      return this.parse(buffer);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Failed to read file '${filePath}': ${message}`);
    }
  }

  /**
   * Generate a .docx document from structured content.
   *
   * @param content - Document content specification.
   * @returns Generated document as a Buffer.
   */
  async generate(content: DocxContent): Promise<Result<DocxGenerateResult>> {
    try {
      const doc = this.buildDocument(content);
      const buffer = await Packer.toBuffer(doc);

      return ok({
        buffer,
        size: buffer.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Failed to generate .docx: ${message}`);
    }
  }

  /**
   * Generate a .docx document and save it to the filesystem.
   *
   * @param content - Document content specification.
   * @param outputPath - Path where the .docx file will be saved.
   * @returns Generation result with the file path.
   */
  async generateToFile(
    content: DocxContent,
    outputPath: string,
  ): Promise<Result<DocxGenerateResult>> {
    const result = await this.generate(content);
    if (!result.ok) {
      return result;
    }

    try {
      // Ensure parent directory exists
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(outputPath, result.value.buffer);

      return ok({
        ...result.value,
        filePath: outputPath,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(`Failed to write file '${outputPath}': ${message}`);
    }
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Build a `docx` Document from the content specification.
   */
  private buildDocument(content: DocxContent): Document {
    const children: (Paragraph | Table)[] = [];

    // Title
    if (content.title) {
      children.push(
        new Paragraph({
          text: content.title,
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 },
        }),
      );
    }

    // Paragraphs
    for (const spec of content.paragraphs) {
      children.push(this.buildParagraph(spec));
    }

    // Tables
    if (content.tables) {
      for (const tableSpec of content.tables) {
        children.push(this.buildTable(tableSpec));
      }
    }

    return new Document({
      creator: content.creator ?? "WordAgent",
      description: content.description ?? "",
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });
  }

  /**
   * Build a `docx` Paragraph from a ParagraphSpec.
   */
  private buildParagraph(spec: ParagraphSpec): Paragraph {
    const headingMap: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
      Title: HeadingLevel.TITLE,
      Heading1: HeadingLevel.HEADING_1,
      Heading2: HeadingLevel.HEADING_2,
      Heading3: HeadingLevel.HEADING_3,
    };

    const alignmentMap: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
      center: AlignmentType.CENTER,
      right: AlignmentType.RIGHT,
      justify: AlignmentType.JUSTIFIED,
    };

    return new Paragraph({
      children: [
        new TextRun({
          text: spec.text,
          bold: spec.bold,
          italics: spec.italic,
          size: (spec.fontSize ?? 11) * 2, // docx uses half-points
        }),
      ],
      heading: spec.heading ? headingMap[spec.heading] : undefined,
      alignment: spec.alignment ? alignmentMap[spec.alignment] : undefined,
      bullet: spec.bullet ? { level: 0 } : undefined,
    });
  }

  /**
   * Build a `docx` Table from a TableSpec.
   */
  private buildTable(spec: TableSpec): Table {
    const rows: TableRow[] = spec.rows.map((rowCells, rowIdx) => {
      const isHeader = spec.headerRow && rowIdx === 0;
      const cells: TableCell[] = rowCells.map((cellText, colIdx) => {
        return new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: cellText,
                  bold: isHeader,
                  size: 22, // 11pt
                }),
              ],
              alignment: AlignmentType.LEFT,
            }),
          ],
          width: spec.columnWidths
            ? { size: spec.columnWidths[colIdx] ?? 0, type: WidthType.PERCENTAGE }
            : undefined,
          shading: isHeader
            ? { fill: "4472C4", type: "clear", color: "auto" }
            : undefined,
        });
      });

      return new TableRow({
        children: cells,
        tableHeader: isHeader,
      });
    });

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D9DEE7" },
      },
    });
  }
}
