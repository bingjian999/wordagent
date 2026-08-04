import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { AttachmentInfo, PaginationOpts, PaginatedResult } from "../../domain/attachment/AttachmentInfo.js";
import type { IAttachmentRepository } from "../../domain/attachment/IAttachmentRepository.js";

/**
 * File system implementation of IAttachmentRepository.
 *
 * Storage layout:
 *   {storagePath}/{sessionId}/
 *     {attachmentId}.bin      — raw file content
 *     {attachmentId}.meta.json — attachment metadata
 *     index.json               — session index (optional cache)
 *
 * Concurrency model:
 *   - Metadata writes use atomic temp-file + rename pattern
 *   - File content writes are delegated to the caller (AttachmentService)
 *   - Reads are safe for concurrent access
 */
export class FsAttachmentRepository implements IAttachmentRepository {
  constructor(private readonly storagePath: string) {}

  // ================================================================
  // Path utilities — prevent path traversal
  // ================================================================

  /**
   * Sanitize a session ID to prevent path traversal.
   * Only allows alphanumeric, hyphen, and underscore.
   */
  private sanitizeSessionId(sessionId: string): string {
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
    return sessionId;
  }

  /**
   * Sanitize an attachment ID (UUID format expected).
   */
  private sanitizeAttachmentId(id: string): string {
    if (!id || !/^[\w-]+$/.test(id)) {
      throw new Error(`Invalid attachmentId: ${id}`);
    }
    return id;
  }

  /**
   * Get the session directory path, creating it if needed.
   */
  private async getSessionDir(sessionId: string): Promise<string> {
    const safe = this.sanitizeSessionId(sessionId);
    const dir = path.join(this.storagePath, safe);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private getMetaPath(sessionDir: string, id: string): string {
    return path.join(sessionDir, `${this.sanitizeAttachmentId(id)}.meta.json`);
  }

  private getFilePath(sessionDir: string, id: string): string {
    return path.join(sessionDir, `${this.sanitizeAttachmentId(id)}.bin`);
  }

  // ================================================================
  // Atomic write — temp file + rename
  // ================================================================

  /**
   * Atomically write JSON metadata using temp file + rename.
   * This prevents TOCTOU race conditions during concurrent writes.
   */
  private async safeWriteJson(targetPath: string, data: unknown): Promise<void> {
    const tmpPath = `${targetPath}.tmp.${crypto.randomUUID()}`;
    try {
      const content = JSON.stringify(data, null, 2);
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // Clean up temp file on failure
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Atomically write binary file content using temp file + rename.
   */
  async safeWriteFile(sessionId: string, id: string, data: Buffer): Promise<string> {
    const sessionDir = await this.getSessionDir(sessionId);
    const filePath = this.getFilePath(sessionDir, id);
    const tmpPath = `${filePath}.tmp.${crypto.randomUUID()}`;
    try {
      await fs.writeFile(tmpPath, data);
      await fs.rename(tmpPath, filePath);
      return filePath;
    } catch (err) {
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  // ================================================================
  // IAttachmentRepository implementation
  // ================================================================

  async save(sessionId: string, file: AttachmentInfo): Promise<string> {
    const sessionDir = await this.getSessionDir(sessionId);
    const metaPath = this.getMetaPath(sessionDir, file.id);
    await this.safeWriteJson(metaPath, file);
    return file.id;
  }

  async findById(sessionId: string, id: string): Promise<AttachmentInfo | null> {
    try {
      const sessionDir = await this.getSessionDir(sessionId);
      const metaPath = this.getMetaPath(sessionDir, id);
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content) as AttachmentInfo;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async findBySession(sessionId: string, opts?: PaginationOpts): Promise<PaginatedResult<AttachmentInfo>> {
    try {
      const safe = this.sanitizeSessionId(sessionId);
      const sessionDir = path.join(this.storagePath, safe);
      const entries = await fs.readdir(sessionDir);
      const metaFiles = entries.filter(e => e.endsWith(".meta.json"));

      const attachments: AttachmentInfo[] = [];
      for (const metaFile of metaFiles) {
        try {
          const content = await fs.readFile(path.join(sessionDir, metaFile), "utf-8");
          attachments.push(JSON.parse(content));
        } catch {
          // Skip corrupt metadata files
        }
      }

      // Sort by upload time, newest first
      attachments.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

      const total = attachments.length;
      const page = opts?.page ?? 1;
      const limit = opts?.limit ?? 20;
      const start = (page - 1) * limit;
      const items = attachments.slice(start, start + limit);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { items: [], total: 0, page: opts?.page ?? 1, limit: opts?.limit ?? 20, totalPages: 1 };
      }
      throw err;
    }
  }

  async delete(sessionId: string, id: string): Promise<boolean> {
    const sessionDir = await this.getSessionDir(sessionId);
    const metaPath = this.getMetaPath(sessionDir, id);
    const filePath = this.getFilePath(sessionDir, id);

    // Check if metadata exists — if not, attachment doesn't exist
    try {
      await fs.access(metaPath);
    } catch {
      return false;
    }

    // Delete metadata and file content
    try { await fs.unlink(metaPath); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    try { await fs.unlink(filePath); } catch (e: any) { if (e.code !== "ENOENT") throw e; }

    return true;
  }

  async deleteBySession(sessionId: string): Promise<number> {
    try {
      const safe = this.sanitizeSessionId(sessionId);
      const sessionDir = path.join(this.storagePath, safe);

      // Count and delete files individually (more reliable on Windows than fs.rm)
      const entries = await fs.readdir(sessionDir);
      const count = entries.filter(e => e.endsWith(".meta.json")).length;

      for (const entry of entries) {
        try {
          await fs.unlink(path.join(sessionDir, entry));
        } catch { /* ignore individual file errors */ }
      }

      // Remove the now-empty directory
      try {
        await fs.rmdir(sessionDir);
      } catch { /* ignore — directory may have been recreated */ }

      return count;
    } catch (err: any) {
      if (err.code === "ENOENT") return 0;
      throw err;
    }
  }

  async exists(sessionId: string, id: string): Promise<boolean> {
    try {
      const sessionDir = await this.getSessionDir(sessionId);
      const metaPath = this.getMetaPath(sessionDir, id);
      await fs.access(metaPath);
      return true;
    } catch {
      return false;
    }
  }

  async count(sessionId: string): Promise<number> {
    try {
      const safe = this.sanitizeSessionId(sessionId);
      const sessionDir = path.join(this.storagePath, safe);
      const entries = await fs.readdir(sessionDir);
      return entries.filter(e => e.endsWith(".meta.json")).length;
    } catch (err: any) {
      if (err.code === "ENOENT") return 0;
      throw err;
    }
  }

  /**
   * Read the raw file content for an attachment.
   * Used by AttachmentService for download and text extraction.
   */
  async readFile(sessionId: string, id: string): Promise<Buffer> {
    const sessionDir = await this.getSessionDir(sessionId);
    const filePath = this.getFilePath(sessionDir, id);
    return fs.readFile(filePath);
  }

  /**
   * Get the absolute file path for an attachment.
   * Used for streaming downloads.
   */
  async getFilePath_(sessionId: string, id: string): Promise<string> {
    const sessionDir = await this.getSessionDir(sessionId);
    return this.getFilePath(sessionDir, id);
  }
}
