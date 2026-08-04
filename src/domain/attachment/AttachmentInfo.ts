/**
 * Attachment entity - core domain model representing an uploaded file.
 */
export interface AttachmentInfo {
  /** Unique identifier (UUID) */
  id: string;
  /** Session ID that owns this attachment */
  sessionId: string;
  /** Original filename */
  originalName: string;
  /** MIME type detected from file content */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Storage path relative to storage root */
  storagePath: string;
  /** Upload timestamp (ISO 8601) */
  uploadedAt: string;
  /** File hash (SHA-256) for deduplication and integrity */
  hash?: string;
  /** Text preview (first N characters, if extractable) */
  preview?: string;
  /** Detected text encoding */
  encoding?: string;
}

/**
 * Value object for pagination options.
 */
export interface PaginationOpts {
  /** Page number (1-based) */
  page?: number;
  /** Items per page */
  limit?: number;
}

/**
 * Value object for paginated results.
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
