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

      for (const entry of entries) {
        // Only process directories (session folders)
        if (!entry.isDirectory()) continue;
        // Skip internal directories (e.g., _audit)
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

        sessionsScanned++;
        const sessionDir = path.join(this.storagePath, entry.name);

        try {
          const lastActivity = await this.getLastActivity(sessionDir);
          const ageMs = now - lastActivity;

          if (ageMs > this.ttlMs) {
            // Session expired — delete it
            const fileCount = await this.countFiles(sessionDir);
            await fs.rm(sessionDir, { recursive: true, force: true });
            sessionsDeleted++;
            attachmentsDeleted += fileCount;
            this.logger.log(`[Retention] Expired session ${entry.name}: ${fileCount} attachments, age ${Math.round(ageMs / 1000 / 60)}min`);
          }
        } catch (err: any) {
          errors.push(`Session ${entry.name}: ${err.message}`);
        }
      }
    } catch (err: any) {
      // Storage path doesn't exist or isn't readable
      if (err.code !== "ENOENT") {
        errors.push(`Storage scan: ${err.message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    return { sessionsScanned, sessionsDeleted, attachmentsDeleted, durationMs, errors };
  }

  /**
   * Determine the last activity timestamp for a session directory.
   *
   * Strategy:
   * 1. Read all .meta.json files and find the newest `uploadedAt`
   * 2. Fallback: use the directory's mtime
   *
   * @param sessionDir - Path to the session directory
   * @returns Timestamp in milliseconds since epoch
   */
  private async getLastActivity(sessionDir: string): Promise<number> {
    try {
      const files = await fs.readdir(sessionDir);
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

      if (metaFiles.length === 0) {
        // No metadata — use directory mtime
        const stat = await fs.stat(sessionDir);
        return stat.mtimeMs;
      }

      let newest = 0;
      for (const metaFile of metaFiles) {
        try {
          const content = await fs.readFile(path.join(sessionDir, metaFile), "utf-8");
          const meta = JSON.parse(content);
          const uploadedAt = new Date(meta.uploadedAt).getTime();
          if (uploadedAt > newest) newest = uploadedAt;
        } catch {
          // Skip invalid metadata files
        }
      }

      if (newest > 0) return newest;

      // Fallback: directory mtime
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
