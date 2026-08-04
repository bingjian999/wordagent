import type { AttachmentInfo, PaginationOpts, PaginatedResult } from "../../domain/attachment/AttachmentInfo.js";
import type { IAttachmentRepository } from "../../domain/attachment/IAttachmentRepository.js";

/**
 * In-memory mock repository for unit testing.
 * Implements the same IAttachmentRepository interface as the real FsAttachmentRepository.
 * Allows Service layer tests to run without file system dependencies.
 */
export class MockAttachmentRepository implements IAttachmentRepository {
  private store = new Map<string, Map<string, AttachmentInfo>>();

  private getSessionStore(sessionId: string): Map<string, AttachmentInfo> {
    let session = this.store.get(sessionId);
    if (!session) {
      session = new Map();
      this.store.set(sessionId, session);
    }
    return session;
  }

  async save(sessionId: string, file: AttachmentInfo): Promise<string> {
    const session = this.getSessionStore(sessionId);
    session.set(file.id, file);
    return file.id;
  }

  async findById(sessionId: string, id: string): Promise<AttachmentInfo | null> {
    return this.getSessionStore(sessionId).get(id) ?? null;
  }

  async findBySession(sessionId: string, opts?: PaginationOpts): Promise<PaginatedResult<AttachmentInfo>> {
    const session = this.getSessionStore(sessionId);
    const all = Array.from(session.values());
    const total = all.length;
    const page = opts?.page ?? 1;
    const limit = opts?.limit ?? 20;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async delete(sessionId: string, id: string): Promise<boolean> {
    return this.getSessionStore(sessionId).delete(id);
  }

  async deleteBySession(sessionId: string): Promise<number> {
    const session = this.store.get(sessionId);
    if (!session) return 0;
    const count = session.size;
    this.store.delete(sessionId);
    return count;
  }

  async exists(sessionId: string, id: string): Promise<boolean> {
    return this.getSessionStore(sessionId).has(id);
  }

  async count(sessionId: string): Promise<number> {
    return this.getSessionStore(sessionId).size;
  }

  /** Test helper: reset all data */
  reset(): void {
    this.store.clear();
  }
}
