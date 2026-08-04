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
  /** CORS allowed origins (supports wildcards, e.g. http://localhost:*) */
  corsOrigins: string[];
  /** HTTP server port (default: 3141) */
  httpPort: number;
  /**
   * Secret key for HMAC-based session token verification.
   * If empty, session IDs are accepted without signature verification
   * (suitable for localhost-only deployments). Set to a random string
   * when deploying to non-local environments.
   */
  sessionSecret: string;
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
    sessionSecret: process.env.WORD_AI_SESSION_SECRET ?? "",
  };
}

/**
 * Create a CORS origin validator function from wildcard patterns.
 *
 * The `cors` package does exact string matching on arrays, so patterns
 * like `http://localhost:*` silently fail. This function converts
 * wildcard patterns into a regex-based validator.
 *
 * @param patterns - Array of origin patterns (supports `*` wildcard)
 * @returns A function compatible with cors({ origin: ... })
 */
export function createCorsOriginValidator(patterns: string[]): (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void {
  const regexes = patterns.map(pattern => {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  });

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no Origin header (same-origin, curl, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = regexes.some(regex => regex.test(origin));
    callback(null, allowed);
  };
}
