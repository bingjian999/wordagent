import express, { type Express } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { ServiceContainer } from "../../di/container.js";
import { createAttachmentRouter } from "./routes.js";
import { errorHandler } from "./middleware.js";

/**
 * Create and configure the Express application.
 *
 * Middleware stack (order matters):
 *   1. CORS — allow configured origins
 *   2. JSON body parser
 *   3. Rate limiting — per-IP throttle
 *   4. Routes — /api/attachments/*
 *   5. 404 handler
 *   6. Global error handler — last
 *
 * @param services - DI container with all service instances
 * @returns Configured Express app (not yet listening)
 */
export function createApp(services: ServiceContainer): Express {
  const app = express();

  // 1. CORS
  app.use(
    cors({
      origin: services.config.corsOrigins,
      methods: ["GET", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "x-session-id"],
      maxAge: 3600,
    }),
  );

  // 2. JSON body parser (for non-multipart routes)
  app.use(express.json({ limit: "1mb" }));

  // 3. Rate limiting — per IP
  const limiter = rateLimit({
    windowMs: services.config.rateLimit.windowMs,
    max: services.config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests, please try again later",
      },
    },
  });
  app.use("/api/", limiter);

  // 4. Health check (no rate limit)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 5. Attachment routes
  app.use("/api/attachments", createAttachmentRouter(services));

  // 6. 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    });
  });

  // 7. Global error handler — must be last
  app.use(errorHandler);

  return app;
}

/**
 * Start the HTTP server.
 * Returns the server instance for graceful shutdown.
 */
export function startServer(services: ServiceContainer): ReturnType<Express["listen"]> {
  const app = createApp(services);
  const port = services.config.httpPort;

  const server = app.listen(port, () => {
    console.log(`[word-ai] HTTP API listening on http://localhost:${port}`);
    console.log(`[word-ai] Storage path: ${services.config.storagePath}`);
    console.log(`[word-ai] Max file size: ${(services.config.maxFileSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`[word-ai] Rate limit: ${services.config.rateLimit.max} req / ${services.config.rateLimit.windowMs}ms`);
  });

  return server;
}
