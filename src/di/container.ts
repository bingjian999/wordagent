import type { AppConfig } from "../config/index.js";
import type { IAttachmentRepository } from "../domain/attachment/IAttachmentRepository.js";
import { FsAttachmentRepository } from "../infrastructure/fs/FsAttachmentRepository.js";
import { MockAttachmentRepository } from "../infrastructure/fs/MockAttachmentRepository.js";
import { FileIntelligenceService } from "../services/parser/FileIntelligenceService.js";
import { AttachmentService } from "../services/attachment/AttachmentService.js";

/**
 * Service container holding all application service instances.
 * Created once at Extension initialization and shared across HTTP routes and tools.
 */
export interface ServiceContainer {
  /** Attachment repository (persistence layer) */
  repository: IAttachmentRepository;
  /** File intelligence service (hash, encoding, preview) */
  fileIntel: FileIntelligenceService;
  /** Attachment business service */
  attachmentService: AttachmentService;
  /** Application configuration */
  config: AppConfig;
}

/**
 * Create and wire all services with dependency injection.
 *
 * Uses FsAttachmentRepository for file system persistence.
 * Called from Extension's `session_start` event handler.
 *
 * @param config - Application configuration loaded from environment
 * @returns Wired service container
 */
export function createServices(config: AppConfig): ServiceContainer {
  const repository = new FsAttachmentRepository(config.storagePath);
  const fileIntel = new FileIntelligenceService();
  const attachmentService = new AttachmentService(repository, fileIntel, config);

  return {
    repository,
    fileIntel,
    attachmentService,
    config,
  };
}

/**
 * Create a service container with a custom repository (for testing).
 * Uses MockAttachmentRepository by default for in-memory tests.
 */
export function createTestServices(
  config: AppConfig,
  repository?: IAttachmentRepository,
): ServiceContainer {
  const repo = repository ?? new MockAttachmentRepository();
  const fileIntel = new FileIntelligenceService();
  const attachmentService = new AttachmentService(repo, fileIntel, config);

  return {
    repository: repo,
    fileIntel,
    attachmentService,
    config,
  };
}
