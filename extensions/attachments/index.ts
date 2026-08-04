/**
 * Word AI - Phase 1 Attachment Tools Extension
 *
 * Provides Pi Agent tools for attachment management:
 *   - attachment_upload:   Upload a file (text or base64 content)
 *   - attachment_list:     List attachments in current session
 *   - attachment_info:     Get metadata for a specific attachment
 *   - attachment_read:     Read text content of an attachment
 *   - attachment_download: Get base64-encoded content of an attachment
 *   - attachment_delete:   Delete a single attachment
 *   - attachment_clear:    Clear all attachments (requires confirm)
 *
 * All tools enforce session isolation via ctx.sessionManager.getSessionId().
 * Services are shared via the DI container, initialized in session_start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../../src/config/index.js";
import { createServices, type ServiceContainer } from "../../src/di/container.js";

// Module-level state for session-scoped resources
let services: ServiceContainer | null = null;

export default function (pi: ExtensionAPI) {
  // ================================================================
  // Lifecycle: session_start — initialize services
  // ================================================================
  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig();
    services = createServices(config);
    console.log(`[Attachments] Services initialized. Storage: ${config.storagePath}`);

    if (ctx.hasUI) {
      ctx.ui.notify("Word AI: Attachment tools ready", "info");
    }
  });

  // ================================================================
  // Lifecycle: session_shutdown — cleanup
  // ================================================================
  pi.on("session_shutdown", async () => {
    services = null;
    console.log("[Attachments] Services cleaned up.");
  });

  // ================================================================
  // Tool: attachment_upload
  // ================================================================
  pi.registerTool({
    name: "attachment_upload",
    label: "Upload Attachment",
    description:
      "Upload a file as an attachment to the current session. " +
      "Provide content as text (default) or base64 for binary files. " +
      "Returns attachment ID and metadata.",
    parameters: Type.Object({
      filename: Type.String({ description: "Original filename including extension (e.g. report.pdf)" }),
      content: Type.String({ description: "File content. Text for text files, base64 for binary." }),
      encoding: Type.Optional(
        Type.Union([Type.Literal("text"), Type.Literal("base64")], {
          description: "Content encoding: 'text' (default) or 'base64' for binary files",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const filename = params.filename as string;
      const content = params.content as string;
      const encoding = (params.encoding as "text" | "base64") ?? "text";

      onUpdate?.({
        content: [{ type: "text" as const, text: `Uploading ${filename}...` }],
        details: { progress: 30 },
      });

      const buffer = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");

      const result = await services.attachmentService.upload(sessionId, {
        originalName: filename,
        content: buffer,
      });

      if (!result.ok) {
        return errorResult(`Upload failed: ${result.error}`, { code: result.error });
      }

      if (signal?.aborted) {
        return { content: [{ type: "text" as const, text: "Cancelled" }], details: { cancelled: true } };
      }

      const a = result.value.attachment;
      return {
        content: [
          {
            type: "text" as const,
            text: `Uploaded: ${a.originalName}\nID: ${a.id}\nSize: ${a.size} bytes\nType: ${a.mimeType}\nHash: ${a.hash ?? "n/a"}`,
          },
        ],
        details: { attachmentId: a.id, size: a.size, mimeType: a.mimeType, hash: a.hash },
      };
    },
  });

  // ================================================================
  // Tool: attachment_list
  // ================================================================
  pi.registerTool({
    name: "attachment_list",
    label: "List Attachments",
    description:
      "List all attachments in the current session with optional pagination. " +
      "Returns attachment metadata including ID, filename, size, and upload time.",
    parameters: Type.Object({
      page: Type.Optional(Type.Number({ description: "Page number (1-based, default 1)" })),
      limit: Type.Optional(Type.Number({ description: "Items per page (default 20, max 100)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const page = (params.page as number) ?? 1;
      const limit = Math.min(100, (params.limit as number) ?? 20);

      const result = await services.attachmentService.findBySession(sessionId, { page, limit });

      if (result.items.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No attachments found in this session." }],
          details: { total: 0, page, limit },
        };
      }

      const lines = result.items.map((a, i) => {
        const num = (page - 1) * limit + i + 1;
        return `${num}. [${a.id.substring(0, 8)}] ${a.originalName} (${a.size} bytes, ${a.mimeType}) — ${a.uploadedAt}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Attachments (page ${result.page}/${result.totalPages}, total ${result.total}):\n\n${lines.join("\n")}`,
          },
        ],
        details: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
          items: result.items.map((a) => ({
            id: a.id,
            originalName: a.originalName,
            size: a.size,
            mimeType: a.mimeType,
            uploadedAt: a.uploadedAt,
          })),
        },
      };
    },
  });

  // ================================================================
  // Tool: attachment_info
  // ================================================================
  pi.registerTool({
    name: "attachment_info",
    label: "Attachment Info",
    description: "Get detailed metadata for a specific attachment by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Attachment ID (UUID)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const id = params.id as string;

      const result = await services.attachmentService.findById(sessionId, id);

      if (!result.ok) {
        return errorResult(`Attachment not found: ${id}`, { code: result.error });
      }

      const a = result.value;
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Attachment: ${a.originalName}`,
              `ID: ${a.id}`,
              `Size: ${a.size} bytes`,
              `Type: ${a.mimeType}`,
              `Uploaded: ${a.uploadedAt}`,
              `Hash: ${a.hash ?? "n/a"}`,
              `Encoding: ${a.encoding ?? "n/a"}`,
              a.preview ? `Preview: ${a.preview.substring(0, 200)}${a.preview.length > 200 ? "..." : ""}` : "Preview: (binary file)",
            ].join("\n"),
          },
        ],
        details: { ...a },
      };
    },
  });

  // ================================================================
  // Tool: attachment_read
  // ================================================================
  pi.registerTool({
    name: "attachment_read",
    label: "Read Attachment Text",
    description:
      "Read the text content of a text-based attachment. " +
      "For binary files, use attachment_download instead. " +
      "Returns the decoded text content.",
    parameters: Type.Object({
      id: Type.String({ description: "Attachment ID (UUID)" }),
      maxChars: Type.Optional(
        Type.Number({ description: "Maximum characters to return (default 10000)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const id = params.id as string;
      const maxChars = (params.maxChars as number) ?? 10000;

      onUpdate?.({
        content: [{ type: "text" as const, text: `Reading attachment ${id}...` }],
        details: { progress: 50 },
      });

      const result = await services.attachmentService.readText(sessionId, id);

      if (!result.ok) {
        return errorResult(`Read failed: ${result.error}`, { code: result.error });
      }

      const { text, encoding, size } = result.value;
      const truncated = text.length > maxChars;
      const outputText = truncated ? text.substring(0, maxChars) + "\n\n... (truncated)" : text;

      return {
        content: [
          {
            type: "text" as const,
            text: `Content (${encoding}, ${size} bytes${truncated ? `, truncated to ${maxChars} chars` : ""}):\n\n${outputText}`,
          },
        ],
        details: { encoding, size, truncated, fullLength: text.length },
      };
    },
  });

  // ================================================================
  // Tool: attachment_download
  // ================================================================
  pi.registerTool({
    name: "attachment_download",
    label: "Download Attachment",
    description:
      "Download the raw content of an attachment as base64. " +
      "Use for binary files (images, PDFs, etc). " +
      "For text files, attachment_read is more convenient.",
    parameters: Type.Object({
      id: Type.String({ description: "Attachment ID (UUID)" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const id = params.id as string;

      onUpdate?.({
        content: [{ type: "text" as const, text: `Downloading attachment ${id}...` }],
        details: { progress: 50 },
      });

      const result = await services.attachmentService.readFile(sessionId, id);

      if (!result.ok) {
        return errorResult(`Download failed: ${result.error}`, { code: result.error });
      }

      const { content, attachment } = result.value;
      const base64 = content.toString("base64");

      return {
        content: [
          {
            type: "text" as const,
            text: `Downloaded: ${attachment.originalName} (${content.length} bytes, base64 encoded)`,
          },
        ],
        details: {
          attachmentId: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          size: content.length,
          base64,
        },
      };
    },
  });

  // ================================================================
  // Tool: attachment_delete
  // ================================================================
  pi.registerTool({
    name: "attachment_delete",
    label: "Delete Attachment",
    description: "Delete a single attachment by ID. This action cannot be undone.",
    parameters: Type.Object({
      id: Type.String({ description: "Attachment ID (UUID)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const id = params.id as string;

      const result = await services.attachmentService.delete(sessionId, id);

      if (!result.ok) {
        return errorResult(`Delete failed: ${result.error}`, { code: result.error });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: result.value ? `Deleted attachment: ${id}` : `Attachment not found: ${id}`,
          },
        ],
        details: { deleted: result.value, id },
      };
    },
  });

  // ================================================================
  // Tool: attachment_clear
  // ================================================================
  pi.registerTool({
    name: "attachment_clear",
    label: "Clear All Attachments",
    description:
      "Delete ALL attachments in the current session. " +
      "Requires confirm=true to prevent accidental data loss. " +
      "Returns the number of deleted attachments.",
    parameters: Type.Object({
      confirm: Type.Boolean({ description: "Must be true to confirm deletion of all attachments" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!services) {
        return errorResult("Services not initialized");
      }

      const sessionId = ctx.sessionManager.getSessionId();
      const confirm = params.confirm as boolean;

      if (!confirm) {
        return errorResult("Pass confirm=true to clear all attachments");
      }

      const result = await services.attachmentService.deleteBySession(sessionId);

      if (!result.ok) {
        return errorResult(`Clear failed: ${result.error}`, { code: result.error });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Cleared ${result.value} attachment(s) from session.`,
          },
        ],
        details: { deleted: result.value },
      };
    },
  });
}

// ================================================================
// Helpers
// ================================================================

function errorResult(message: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
    details: { error: message, ...details },
  };
}
