import type { AttachmentInfo, PaginationOpts, PaginatedResult } from "./AttachmentInfo.js";

/**
 * Repository interface for attachment persistence.
 * This is the abstraction that upper Service layers depend on.
 * Infrastructure layer provides concrete implementations (e.g., FsAttachmentRepository).
 *
 * Following Clean Architecture / Dependency Inversion:
 * - Service depends on this interface, not on concrete implementation
 * - Extension entry point injects the concrete implementation
 * - Tests inject MockRepository for isolation
 */
export interface IAttachmentRepository {
  /**
   * Save a new attachment.
   * @returns The generated attachment ID
   */
  save(sessionId: string, file: AttachmentInfo): Promise<string>;

  /**
   * Find a single attachment by ID within a session.
   * @returns The attachment, or null if not found
   */
  findById(sessionId: string, id: string): Promise<AttachmentInfo | null>;

  /**
   * Find all attachments for a session with optional pagination.
   * @returns Paginated list of attachments
   */
  findBySession(sessionId: string, opts?: PaginationOpts): Promise<PaginatedResult<AttachmentInfo>>;

  /**
   * Delete a single attachment by ID within a session.
   * @returns true if deleted, false if not found
   */
  delete(sessionId: string, id: string): Promise<boolean>;

  /**
   * Delete all attachments for a session.
   * @returns Number of deleted attachments
   */
  deleteBySession(sessionId: string): Promise<number>;

  /**
   * Check if an attachment exists within a session.
   */
  exists(sessionId: string, id: string): Promise<boolean>;

  /**
   * Count attachments for a session.
   */
  count(sessionId: string): Promise<number>;
}
