/**
 * Audit Logger — records destructive operations for compliance and traceability.
 *
 * Logs are written as JSON Lines (JSONL) to a dedicated audit log file.
 * Each entry includes timestamp, action, operator (sessionId), target ID,
 * and additional context.
 *
 * Log file location: {storagePath}/_audit/audit.log
 * When the log file exceeds MAX_LOG_SIZE, it is rotated to audit.log.1
 * and a new audit.log is started.
 *
 * @module AuditLogger
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Maximum log file size before rotation (10 MB) */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/** Maximum number of rotated log files to keep */
const MAX_ROTATED_FILES = 5;

/**
 * Audit log entry for a destructive operation.
 */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Action type: delete | clear | upload | download */
  action: string;
  /** Session ID that performed the action */
  sessionId: string;
  /** Target attachment ID (for single-item operations) */
  targetId?: string;
  /** Target filename (for context) */
  targetName?: string;
  /** Additional context */
  details?: Record<string, unknown>;
}

/**
 * Audit logger that writes JSONL entries to a file.
 *
 * Features:
 * - Append-only JSONL format (one JSON object per line)
 * - Atomic writes via appendFile (OS-level append is atomic for small writes)
 * - Graceful degradation: if logging fails, the operation still succeeds
 *   (audit logging is best-effort, not blocking)
 */
export class AuditLogger {
  private readonly logPath: string;
  private initialized = false;

  /**
   * @param storagePath - Base storage path (same as attachment storage)
   */
  constructor(storagePath: string) {
    this.logPath = path.join(storagePath, "_audit", "audit.log");
  }

  /**
   * Ensure the audit log directory exists.
   * Called once on first use; subsequent calls are no-ops.
   */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      this.initialized = true;
    } catch {
      // Best-effort initialization
      this.initialized = true;
    }
  }

  /**
   * Log an audit entry.
   *
   * This method never throws — audit logging is best-effort.
   * If the log file cannot be written, the error is silently swallowed
   * to avoid blocking the actual operation.
   *
   * When the log file exceeds MAX_LOG_SIZE, it is rotated before writing.
   *
   * @param entry - The audit entry to log
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.ensureInit();
      await this.rotateIfNeeded();
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(this.logPath, line, "utf-8");
    } catch {
      // Best-effort: swallow errors to avoid blocking operations
    }
  }

  /**
   * Check if the log file needs rotation and rotate if necessary.
   * Rotation renames audit.log → audit.log.1, audit.log.1 → audit.log.2, etc.
   * Old files beyond MAX_ROTATED_FILES are deleted.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.logPath);
      if (stat.size < MAX_LOG_SIZE) return;

      // Shift rotated files: .N → .N+1
      for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
        const from = `${this.logPath}.${i}`;
        const to = `${this.logPath}.${i + 1}`;
        try {
          if (i === MAX_ROTATED_FILES) {
            // Delete the oldest rotated file
            await fs.unlink(from);
          } else {
            await fs.rename(from, to);
          }
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }

      // Rotate current log to .1
      await fs.rename(this.logPath, `${this.logPath}.1`);
    } catch (err: unknown) {
      // If log file doesn't exist yet, nothing to rotate
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // Swallow other errors — rotation is best-effort
      }
    }
  }

  /**
   * Log a delete operation.
   *
   * @param sessionId - Session that performed the delete
   * @param attachmentId - ID of the deleted attachment
   * @param attachmentName - Original filename (for context)
   */
  async logDelete(sessionId: string, attachmentId: string, attachmentName?: string): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      action: "delete",
      sessionId,
      targetId: attachmentId,
      targetName: attachmentName,
    });
  }

  /**
   * Log a clear-all operation.
   *
   * @param sessionId - Session that performed the clear
   * @param deletedCount - Number of attachments deleted
   */
  async logClear(sessionId: string, deletedCount: number): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      action: "clear",
      sessionId,
      details: { deletedCount },
    });
  }

  /**
   * Log an upload operation (optional, for completeness).
   *
   * @param sessionId - Session that performed the upload
   * @param attachmentId - ID of the uploaded attachment
   * @param attachmentName - Original filename
   * @param size - File size in bytes
   */
  async logUpload(sessionId: string, attachmentId: string, attachmentName: string, size: number): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      action: "upload",
      sessionId,
      targetId: attachmentId,
      targetName: attachmentName,
      details: { size },
    });
  }

  /**
   * Read all audit log entries from the current and rotated log files.
   * Useful for administrative review.
   *
   * @returns Array of audit entries, oldest first
   */
  async readAll(): Promise<AuditEntry[]> {
    const allEntries: AuditEntry[] = [];

    // Read rotated files in reverse order (oldest first: .N, .N-1, ..., .1)
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      try {
        const content = await fs.readFile(`${this.logPath}.${i}`, "utf-8");
        const entries = content
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as AuditEntry);
        allEntries.push(...entries);
      } catch {
        // Rotated file doesn't exist — skip
      }
    }

    // Read current log file
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const entries = content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AuditEntry);
      allEntries.push(...entries);
    } catch {
      // Current log doesn't exist yet — skip
    }

    return allEntries;
  }
}
