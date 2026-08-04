import { Router } from "express";
import multer from "multer";
import type { ServiceContainer } from "../../di/container.js";
import { ErrorCode } from "../../domain/attachment/Result.js";
import { asyncHandler, buildError, createRequireSessionId } from "./middleware.js";

/**
 * Create attachment API routes.
 *
 * All routes require `x-session-id` header for session isolation.
 *
 * Endpoints:
 *   POST   /api/attachments/upload         — single file upload (multipart)
 *   POST   /api/attachments/upload-batch    — batch file upload (multipart)
 *   GET    /api/attachments                 — list with pagination (?page=1&limit=20)
 *   GET    /api/attachments/:id             — get attachment info
 *   GET    /api/attachments/:id/download    — download raw file
 *   GET    /api/attachments/:id/text        — read text content
 *   DELETE /api/attachments/:id             — delete single attachment
 *   DELETE /api/attachments                 — clear all (?confirm=true)
 */
export function createAttachmentRouter(services: ServiceContainer): Router {
  const router = Router();

  // Multer: in-memory storage, size limit from config
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: services.config.maxFileSize,
      files: services.config.maxBatchSize,
    },
  });

  // All routes require session ID (with HMAC verification when secret is configured)
  router.use(createRequireSessionId(services.config.sessionSecret));

  // ================================================================
  // POST /api/attachments/upload — single file upload
  // ================================================================
  router.post(
    "/upload",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const file = (req as any).file as Express.Multer.File | undefined;

      if (!file) {
        res.status(400).json(buildError(ErrorCode.INVALID_INPUT, "No file provided in 'file' field"));
        return;
      }

      const result = await services.attachmentService.upload(sessionId, {
        originalName: file.originalname,
        content: file.buffer,
        mimeType: file.mimetype,
      });

      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      res.status(201).json({
        attachment: result.value.attachment,
      });
    }),
  );

  // ================================================================
  // POST /api/attachments/upload-batch — batch file upload
  // ================================================================
  router.post(
    "/upload-batch",
    upload.array("files", services.config.maxBatchSize),
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const files = (req as any).files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json(buildError("INVALID_INPUT" as ErrorCode, "No files provided in 'files' field"));
        return;
      }

      const inputs = files.map((f) => ({
        originalName: f.originalname,
        content: f.buffer,
        mimeType: f.mimetype,
      }));

      const result = await services.attachmentService.uploadBatch(sessionId, inputs);

      const status = result.uploaded.length > 0 ? 200 : 400;
      res.status(status).json(result);
    }),
  );

  // ================================================================
  // GET /api/attachments — list with pagination
  // ================================================================
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await services.attachmentService.findBySession(sessionId, { page, limit });
      res.json(result);
    }),
  );

  // ================================================================
  // GET /api/attachments/:id — get attachment info
  // ================================================================
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const id = req.params.id;

      const result = await services.attachmentService.findById(sessionId, id);
      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      res.json({ attachment: result.value });
    }),
  );

  // ================================================================
  // GET /api/attachments/:id/download — download raw file
  // ================================================================
  router.get(
    "/:id/download",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const id = req.params.id;

      const result = await services.attachmentService.readFile(sessionId, id);
      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      const { content, attachment } = result.value;
      res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
      res.setHeader("Content-Length", content.length.toString());
      res.send(content);
    }),
  );

  // ================================================================
  // GET /api/attachments/:id/text — read text content
  // ================================================================
  router.get(
    "/:id/text",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const id = req.params.id;

      const result = await services.attachmentService.readText(sessionId, id);
      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      res.json(result.value);
    }),
  );

  // ================================================================
  // DELETE /api/attachments/:id — delete single attachment
  // ================================================================
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const id = req.params.id;

      const result = await services.attachmentService.delete(sessionId, id);
      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      res.json({ deleted: result.value, id });
    }),
  );

  // ================================================================
  // DELETE /api/attachments — clear all (requires ?confirm=true)
  // ================================================================
  router.delete(
    "/",
    asyncHandler(async (req, res) => {
      const sessionId = (req as any).sessionId as string;
      const confirm = req.query.confirm === "true";

      if (!confirm) {
        res.status(400).json(
          buildError(ErrorCode.CLEAR_NOT_CONFIRMED, "Pass ?confirm=true to clear all attachments"),
        );
        return;
      }

      const result = await services.attachmentService.deleteBySession(sessionId);
      if (!result.ok) {
        const status = errorToStatus(result.error);
        res.status(status).json(buildError(result.error, errorToMessage(result.error)));
        return;
      }

      res.json({ deleted: result.value });
    }),
  );

  return router;
}

// ================================================================
// Error mapping helpers
// ================================================================

function errorToStatus(code: ErrorCode): number {
  const map: Record<string, number> = {
    FILE_TOO_LARGE: 413,
    INVALID_EXTENSION: 400,
    SESSION_NOT_FOUND: 400,
    ATTACHMENT_NOT_FOUND: 404,
    RATE_LIMITED: 429,
    CLEAR_NOT_CONFIRMED: 400,
    INVALID_INPUT: 400,
    INTERNAL_ERROR: 500,
  };
  return map[code] ?? 500;
}

function errorToMessage(code: ErrorCode): string {
  const map: Record<string, string> = {
    FILE_TOO_LARGE: "File exceeds maximum allowed size",
    INVALID_EXTENSION: "File extension not allowed",
    SESSION_NOT_FOUND: "Session not found",
    ATTACHMENT_NOT_FOUND: "Attachment not found",
    RATE_LIMITED: "Rate limit exceeded",
    CLEAR_NOT_CONFIRMED: "Confirmation required to clear all attachments",
    INVALID_INPUT: "Invalid input",
    INTERNAL_ERROR: "Internal server error",
  };
  return map[code] ?? code;
}
