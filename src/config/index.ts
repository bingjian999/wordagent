/**
 * Application configuration interface.
 * All configurable parameters are externalized via environment variables.
 */
export interface AppConfig {
  /** Base path for storing attachment files */
  storagePath: string;
  /** Max single file size in bytes (default: 50MB) */
  maxFileSize: number;
  /** Max number of files in a batch upload (default: 20) */
  maxBatchSize: number;
  /** Allowed file extensions (without dot) */
  allowedExtensions: string[];
  /** Rate limiting configuration */
  rateLimit: {
    /** Time window in milliseconds */
    windowMs: number;
    /** Max requests per window */
    max: number;
  };
  /** Session TTL in seconds (default: 7 days) */
  sessionTtl: number;
  /** Shell command timeout in milliseconds (default: 30s) */
  shellTimeout: number;
  /** CORS allowed origins */
  corsOrigins: string[];
  /** HTTP server port (default: 3141) */
  httpPort: number;
}

/**
 * Load configuration from environment variables with sensible defaults.
 * Falls back to default values when environment variables are not set.
 */
export function loadConfig(): AppConfig {
  return {
    storagePath: process.env.WORD_AI_STORAGE_PATH ?? "./data/attachments",
    maxFileSize: parseInt(process.env.WORD_AI_MAX_FILE_SIZE ?? "") || 50 * 1024 * 1024,
    maxBatchSize: parseInt(process.env.WORD_AI_MAX_BATCH ?? "") || 20,
    allowedExtensions: (process.env.WORD_AI_ALLOWED_EXT ?? "pdf,txt,md,json,csv,docx,xlsx,png,jpg,gif").split(","),
    rateLimit: {
      windowMs: parseInt(process.env.WORD_AI_RATE_WINDOW ?? "") || 60000,
      max: parseInt(process.env.WORD_AI_RATE_MAX ?? "") || 20,
    },
    sessionTtl: parseInt(process.env.WORD_AI_SESSION_TTL ?? "") || 7 * 24 * 3600,
    shellTimeout: parseInt(process.env.WORD_AI_SHELL_TIMEOUT ?? "") || 30000,
    corsOrigins: (process.env.WORD_AI_CORS_ORIGINS ?? "http://localhost:*").split(","),
    httpPort: parseInt(process.env.WORD_AI_HTTP_PORT ?? "") || 3141,
  };
}
