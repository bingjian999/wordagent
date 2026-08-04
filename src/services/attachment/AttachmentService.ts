import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/index.js";
import type { AttachmentInfo, PaginationOpts, PaginatedResult } from "../../domain/attachment/AttachmentInfo.js";
import type { IAttachmentRepository } from "../../domain/attachment/IAttachmentRepository.js";
import type { Result } from "../../domain/attachment/Result.js";
import { ok, err, ErrorCode } from "../../domain/attachment/Result.js";
import type { FileIntelligenceService } from "../parser/FileIntelligenceService.js";
import type { AuditLogger } from "../audit/AuditLogger.js";

/**
 * Attachment Service — business logic layer.
 *
 * Responsibilities:
 * - Validate uploads (size, extension, session)
 * - Analyze files via FileIntelligenceService
 * - Persist files + metadata via IAttachmentRepository
 * - Enforce session isolation
 * - Provide read/delete operations with ownership checks
 * - Log destructive operations via AuditLogger
 *
 * Depends on IAttachmentRepository (interface), FileIntelligenceService,
 * and AuditLogger. Concrete implementations are injected via DI container.
 */

/** Input for uploading a file */
export interface UploadInput {
  /** Original filename from client */
  originalName: string;
  /** File content buffer */
  content: Buffer;
  /** Optional MIME type override (otherwise auto-detected) */
  mimeType?: string;
}

/** Uploaded file info + analysis result */
export interface UploadResult {
  attachment: AttachmentInfo;
}

/** File content read result */
export interface ReadResult {
  content: Buffer;
  attachment: AttachmentInfo;
}

export class AttachmentService {
  private readonly auditLogger: AuditLogger | null;

  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly fileIntel: FileIntelligenceService,
    private readonly config: AppConfig,
    auditLogger?: AuditLogger,
  ) {
    this.auditLogger = auditLogger ?? null;
  }

  // ================================================================
  // Upload
  // ================================================================

  async upload(sessionId: string, input: UploadInput): Promise<Result<UploadResult, ErrorCode>> {
    // Validate session ID
    if (!sessionId || sessionId.trim().length === 0) {
      return err(ErrorCode.SESSION_NOT_FOUND);
    }

    // Validate filename
    if (!input.originalName || input.originalName.trim().length === 0) {
      return err(ErrorCode.INVALID_INPUT);
    }

    // Validate file size
    if (input.content.length > this.config.maxFileSize) {
      return err(ErrorCode.FILE_TOO_LARGE);
    }

    // Validate extension — when a whitelist is configured, files without
    // an extension (ext === "") must also be rejected. The previous check
    // (`ext && ...`) short-circuited on empty string, allowing extensionless
    // files to bypass the whitelist entirely.
    const ext = this.fileIntel.getExtension(input.originalName);
    if (this.config.allowedExtensions.length > 0 && !this.config.allowedExtensions.includes(ext)) {
      return err(ErrorCode.INVALID_EXTENSION);
    }

    // Analyze file
    const analysis = this.fileIntel.analyze(input.content, input.originalName);

    // Create attachment metadata
    const id = randomUUID();
    const attachment: AttachmentInfo = {
      id,
      sessionId,
      originalName: input.originalName,
      mimeType: input.mimeType ?? analysis.mimeType,
      size: input.content.length,
      storagePath: `${sessionId}/${id}.bin`,
      uploadedAt: new Date().toISOString(),
      hash: analysis.hash,
      preview: analysis.preview ?? undefined,
      encoding: analysis.encoding,
    };

    // Write file content to disk (if using FsAttachmentRepository)
    if (typeof (this.repository as any).safeWriteFile === "function") {
      try {
        await (this.repository as any).safeWriteFile(sessionId, id, input.content);
      } catch {
        return err(ErrorCode.INTERNAL_ERROR);
      }
    }

    // Save metadata
    try {
      await this.repository.save(sessionId, attachment);
    } catch {
      return err(ErrorCode.INTERNAL_ERROR);
    }

    // Audit log (best-effort, non-blocking)
    if (this.auditLogger) {
      await this.auditLogger.logUpload(sessionId, id, input.originalName, input.content.length);
    }

    return ok({ attachment });
  }

  // ================================================================
  // Batch upload
  // ================================================================

  async uploadBatch(sessionId: string, inputs: UploadInput[]): Promise<{
    uploaded: AttachmentInfo[];
    errors: Array<{ filename: string; error: ErrorCode }>;
  }> {
    if (inputs.length > this.config.maxBatchSize) {
      return {
        uploaded: [],
        errors: [{ filename: "(batch)", error: ErrorCode.INVALID_INPUT }],
      };
    }

    const uploaded: AttachmentInfo[] = [];
    const errors: Array<{ filename: string; error: ErrorCode }> = [];

    for (const input of inputs) {
      const result = await this.upload(sessionId, input);
      if (result.ok) {
        uploaded.push(result.value.attachment);
      } else {
        errors.push({ filename: input.originalName, error: result.error });
      }
    }

    return { uploaded, errors };
  }

  // ================================================================
  // Read
  // ================================================================

  async findById(sessionId: string, id: string): Promise<Result<AttachmentInfo, ErrorCode>> {
    const attachment = await this.repository.findById(sessionId, id);
    if (!attachment) return err(ErrorCode.ATTACHMENT_NOT_FOUND);
    return ok(attachment);
  }

  async findBySession(sessionId: string, opts?: PaginationOpts): Promise<PaginatedResult<AttachmentInfo>> {
    return this.repository.findBySession(sessionId, opts);
  }

  async readFile(sessionId: string, id: string): Promise<Result<ReadResult, ErrorCode>> {
    const attachmentResult = await this.findById(sessionId, id);
    if (!attachmentResult.ok) return err(attachmentResult.error);

    try {
      // Use FsAttachmentRepository.readFile if available
      if (typeof (this.repository as any).readFile === "function") {
        const content = await (this.repository as any).readFile(sessionId, id);
        return ok({ content, attachment: attachmentResult.value });
      }
      return err(ErrorCode.INTERNAL_ERROR);
    } catch {
      return err(ErrorCode.ATTACHMENT_NOT_FOUND);
    }
  }

  /**
   * Get absolute file path for streaming downloads.
   * Only available with FsAttachmentRepository.
   */
  async getFilePath(sessionId: string, id: string): Promise<Result<string, ErrorCode>> {
    const exists = await this.repository.exists(sessionId, id);
    if (!exists) return err(ErrorCode.ATTACHMENT_NOT_FOUND);

    if (typeof (this.repository as any).getFilePath_ === "function") {
      const filePath = await (this.repository as any).getFilePath_(sessionId, id);
      return ok(filePath);
    }
    return err(ErrorCode.INTERNAL_ERROR);
  }

  /**
   * Read text content from a text attachment.
   */
  async readText(sessionId: string, id: string): Promise<Result<{ text: string; encoding: string; size: number }, ErrorCode>> {
    const readResult = await this.readFile(sessionId, id);
    if (!readResult.ok) return err(readResult.error);

    const { content, attachment } = readResult.value;
    const encoding = attachment.encoding ?? "utf-8";
    const text = content.toString(encoding as BufferEncoding);

    return ok({ text, encoding, size: content.length });
  }

  // ================================================================
  // Delete
  // ================================================================

  async delete(sessionId: string, id: string): Promise<Result<boolean, ErrorCode>> {
    const attachment = await this.repository.findById(sessionId, id);
    if (!attachment) return err(ErrorCode.ATTACHMENT_NOT_FOUND);

    const deleted = await this.repository.delete(sessionId, id);

    // Audit log (best-effort, non-blocking)
    if (deleted && this.auditLogger) {
      await this.auditLogger.logDelete(sessionId, id, attachment.originalName);
    }

    return ok(deleted);
  }

  async deleteBySession(sessionId: string): Promise<Result<number, ErrorCode>> {
    const count = await this.repository.deleteBySession(sessionId);

    // Audit log (best-effort, non-blocking)
    if (this.auditLogger) {
      await this.auditLogger.logClear(sessionId, count);
    }

    return ok(count);
  }

  // ================================================================
  // Utilities
  // ================================================================

  async exists(sessionId: string, id: string): Promise<boolean> {
    return this.repository.exists(sessionId, id);
  }

  async count(sessionId: string): Promise<number> {
    return this.repository.count(sessionId);
  }
}
