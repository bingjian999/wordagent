/**
 * DocxTool — Pi Agent tool for Word document operations.
 *
 * Wraps {@link DocxService} to provide two operations accessible from
 * Pi Agent sessions:
 *
 * - **parse**: Extract text from a .docx file on disk or from an
 *   attachment (via session ID + attachment ID).
 * - **generate**: Create a .docx file from structured content
 *   (paragraphs, headings, tables) and save it to disk.
 *
 * @module DocxTool
 */

import {
  DocxService,
  type DocxContent,
  type ParagraphSpec,
  type TableSpec,
  type DocxParseResult,
  type DocxGenerateResult,
} from "../services/docx/DocxService.js";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** Parameters for the DocxTool. */
export interface DocxToolParams {
  /** Operation to perform. */
  operation: "parse" | "generate";

  /**
   * For `parse`: path to the .docx file to parse.
   * For `generate`: output path for the generated .docx file.
   */
  filePath: string;

  /** For `generate` only: document title. */
  title?: string;

  /** For `generate` only: array of paragraph specifications. */
  paragraphs?: ParagraphSpec[];

  /** For `generate` only: array of table specifications. */
  tables?: TableSpec[];

  /** For `generate` only: document creator metadata. */
  creator?: string;

  /** For `generate` only: document description metadata. */
  description?: string;
}

/** Result of a DocxTool operation. */
export interface DocxToolResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Operation name. */
  operation: string;
  /** Human-readable status or error message. */
  message: string;
  /** For `parse`: extracted text content. */
  text?: string;
  /** For `parse`: extracted HTML content. */
  html?: string;
  /** For `parse`: character count. */
  charCount?: number;
  /** For `generate`: output file path. */
  filePath?: string;
  /** For `generate`: file size in bytes. */
  size?: number;
}

// ------------------------------------------------------------------
// DocxTool
// ------------------------------------------------------------------

/**
 * Tool for parsing and generating Word (.docx) documents.
 *
 * @example
 * ```ts
 * const tool = new DocxTool();
 *
 * // Parse a .docx file
 * const parseResult = await tool.execute({
 *   operation: "parse",
 *   filePath: "report.docx",
 * });
 *
 * // Generate a .docx file
 * const genResult = await tool.execute({
 *   operation: "generate",
 *   filePath: "output.docx",
 *   title: "Q1 Report",
 *   paragraphs: [
 *     { text: "Revenue Summary", heading: "Heading1" },
 *     { text: "Total revenue: ¥1,234,567" },
 *   ],
 *   tables: [{
 *     rows: [["Item", "Amount"], ["Revenue", "1,234,567"]],
 *     headerRow: true,
 *   }],
 * });
 * ```
 */
export class DocxTool {
  private readonly service: DocxService;

  constructor() {
    this.service = new DocxService();
  }

  /**
   * Execute a DOCX operation.
   *
   * @param params - Operation parameters.
   * @returns Operation result.
   */
  async execute(params: DocxToolParams): Promise<DocxToolResult> {
    const operation = params.operation;

    switch (operation) {
      case "parse":
        return this.parse(params.filePath);
      case "generate":
        return this.generate(params);
      default:
        return {
          success: false,
          operation,
          message: `Unknown operation: ${operation}`,
        };
    }
  }

  /**
   * Parse a .docx file and extract text.
   */
  private async parse(filePath: string): Promise<DocxToolResult> {
    if (!filePath) {
      return { success: false, operation: "parse", message: "filePath is required" };
    }

    const result = await this.service.parseFile(filePath);

    if (!result.ok) {
      return {
        success: false,
        operation: "parse",
        message: result.error,
      };
    }

    const parsed: DocxParseResult = result.value;
    return {
      success: true,
      operation: "parse",
      message: `Parsed '${filePath}': ${parsed.charCount} characters extracted`,
      text: parsed.text,
      html: parsed.html,
      charCount: parsed.charCount,
    };
  }

  /**
   * Generate a .docx file from structured content.
   */
  private async generate(params: DocxToolParams): Promise<DocxToolResult> {
    if (!params.filePath) {
      return { success: false, operation: "generate", message: "filePath is required" };
    }

    if (!params.paragraphs || params.paragraphs.length === 0) {
      if (!params.tables || params.tables.length === 0) {
        return {
          success: false,
          operation: "generate",
          message: "At least one paragraph or table is required",
        };
      }
    }

    const content: DocxContent = {
      title: params.title,
      paragraphs: params.paragraphs ?? [],
      tables: params.tables,
      creator: params.creator,
      description: params.description,
    };

    const result = await this.service.generateToFile(content, params.filePath);

    if (!result.ok) {
      return {
        success: false,
        operation: "generate",
        message: result.error,
      };
    }

    const generated: DocxGenerateResult = result.value;
    return {
      success: true,
      operation: "generate",
      message: `Generated '${generated.filePath}': ${generated.size} bytes`,
      filePath: generated.filePath,
      size: generated.size,
    };
  }
}
