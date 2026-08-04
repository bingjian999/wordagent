/**
 * Minimal logger interface for services that need optional logging.
 */
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}
