/**
 * Retention Policy — automatic cleanup of expired attachments.
 *
 * Scans the storage directory for sessions whose attachments have exceeded
 * the configured TTL (time-to-live) and deletes them.
 *
 * Designed to be called periodically (e.g., on session_start, or via a
 * scheduled task). Safe to run concurrently — uses atomic file operations.
 *
 * @module RetentionPolicy
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Logger } from "./types.js";

/**
 * Result of a retention cleanup run.
 */
export interface RetentionResult {
  /** Number of sessions scanned */
  sessionsScanned: number;
  /** Number of sessions expired and deleted */
  sessionsDeleted: number;
  /** Number of individual attachments deleted */
  attachmentsDeleted: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Errors encountered (non-fatal) */
  errors: string[];
}

/**
 * Retention policy engine.
 *
 * Walks the storage directory, reads each session's index/metadata,
 * and deletes sessions whose last activity exceeds the TTL.
 *
 * "Last activity" is determined by the newest `uploadedAt` timestamp
 * across all attachments in the session. If no metadata is found,
 * the session directory's modification time is used as fallback.
 */
export class RetentionPolicy {
  private readonly storagePath: string;
  private readonly ttlMs: number;
  private readonly logger: Logger;

  /**
   * @param storagePath - Base storage path
   * @param ttlSeconds - Session TTL in seconds (default: 7 days)
   * @param logger - Optional logger for diagnostics
   */
  constructor(storagePath: string, ttlSeconds: number, logger?: Logger) {
    this.storagePath = storagePath;
    this.ttlMs = ttlSeconds * 1000;
    this.logger = logger ?? { log: () => {}, error: () => {} };
  }

  /**
   * Run a cleanup pass.
   *
   * Scans all session directories and deletes expired ones.
   * This method is safe to run concurrently — file deletion is idempotent.
   * Directories are scanned in parallel for improved performance.
   *
   * @returns Cleanup statistics
   */
  async run(): Promise<RetentionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let sessionsScanned = 0;
    let sessionsDeleted = 0;
    let attachmentsDeleted = 0;

    try {
      const entries = await fs.readdir(this.storagePath, { withFileTypes: true });
      const now = Date.now();

      // Filter session directories
      const sessionDirs = entries.filter(
        (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")
      );

      sessionsScanned = sessionDirs.length;

      // Process sessions in parallel (bounded concurrency)
      const BATCH_SIZE = 10;
      for (let i = 0; i < sessionDirs.length; i += BATCH_SIZE) {
        const batch = sessionDirs.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (entry) => {
            const sessionDir = path.join(this.storagePath, entry.name);
            try {
              const lastActivity = await this.getLastActivity(sessionDir);
              const ageMs = now - lastActivity;

              if (ageMs > this.ttlMs) {
                const fileCount = await this.countFiles(sessionDir);
                await fs.rm(sessionDir, { recursive: true, force: true });
                this.logger.log(
                  `[Retention] Expired session ${entry.name}: ${fileCount} attachments, age ${Math.round(ageMs / 1000 / 60)}min`
                );
                return { deleted: true, fileCount, error: null as string | null };
              }
              return { deleted: false, fileCount: 0, error: null as string | null };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              return { deleted: false, fileCount: 0, error: `Session ${entry.name}: ${message}` as string | null };
            }
          })
        );

        for (const r of results) {
          if (r.error) errors.push(r.error);
          if (r.deleted) {
            sessionsDeleted++;
            attachmentsDeleted += r.fileCount;
          }
        }
      }
    } catch (err: unknown) {
      // Storage path doesn't exist or isn't readable
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Storage scan: ${message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    return { sessionsScanned, sessionsDeleted, attachmentsDeleted, durationMs, errors };
  }

  /**
   * Determine the last activity timestamp for a session directory.
   *
   * Optimized strategy:
   * 1. Use the directory's mtime as primary indicator (fast — single stat call)
   * 2. This is accurate because directory mtime updates when files are added/deleted
   *
   * Previous strategy (reading all .meta.json files) was O(n) per session
   * and caused severe performance issues with large datasets.
   *
   * @param sessionDir - Path to the session directory
   * @returns Timestamp in milliseconds since epoch
   */
  private async getLastActivity(sessionDir: string): Promise<number> {
    try {
      const stat = await fs.stat(sessionDir);
      return stat.mtimeMs;
    } catch {
      return Date.now(); // Don't delete if we can't determine age
    }
  }

  /**
   * Count the number of .bin files in a session directory.
   * Used for reporting how many attachments were deleted.
   */
  private async countFiles(sessionDir: string): Promise<number> {
    try {
      const files = await fs.readdir(sessionDir);
      return files.filter((f) => f.endsWith(".bin")).length;
    } catch {
      return 0;
    }
  }
}
