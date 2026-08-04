/**
 * Word AI - Phase 0 Demo Extension
 *
 * Purpose: Validate Pi Agent extension model capabilities before building business logic.
 *
 * Verification items:
 * 1. tool_call event interception + block strategy
 * 2. Non-matching tools return undefined (no interference)
 * 3. sessionId isolation via ctx.sessionManager.getSessionId()
 * 4. Skills on-demand triggering (via SKILL.md description field)
 * 5. Extension lifecycle: session_start / session_shutdown
 * 6. Custom tool registration via pi.registerTool()
 * 7. Streaming response via onUpdate callback
 * 8. Shared service container accessible from tools
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../../src/config/index.js";
import { createServices, type ServiceContainer } from "../../src/di/container.js";

// Module-level state for session-scoped resources.
// Reset on session_start, cleaned on session_shutdown.
let services: ServiceContainer | null = null;

/**
 * Phase 0 Verification Log
 * Collects verification results for the Phase 0 validation report.
 */
const verificationLog: string[] = [];

function logVerification(item: string, result: string): void {
  const entry = `[${new Date().toISOString()}] ${item}: ${result}`;
  verificationLog.push(entry);
  console.log(`[Phase0] ${entry}`);
}

export default function (pi: ExtensionAPI) {
  // ================================================================
  // Lifecycle Event: session_start
  // Verifies: Extension lifecycle, resource initialization pattern
  // ================================================================
  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig();
    services = createServices(config);

    logVerification("session_start triggered", "OK");
    logVerification("config loaded", `storagePath=${config.storagePath}`);
    logVerification("services created", `repository=${services.repository.constructor.name}`);

    if (ctx.hasUI) {
      ctx.ui.notify("Word AI Phase 0: Extension loaded, services initialized", "info");
    }
  });

  // ================================================================
  // Lifecycle Event: session_shutdown
  // Verifies: Extension lifecycle, resource cleanup pattern
  // ================================================================
  pi.on("session_shutdown", async (_event, _ctx) => {
    // Clean up session-scoped resources
    services = null;

    logVerification("session_shutdown triggered", "OK");
    logVerification("resources cleaned", "services=null");
    console.log("[Phase0] Verification log:", JSON.stringify(verificationLog, null, 2));
  });

  // ================================================================
  // Event: tool_call
  // Verifies: tool_call event structure, interception, block strategy
  // ================================================================
  pi.on("tool_call", async (event, ctx) => {
    // --- Verification 1: Print complete tool_call event structure ---
    // This confirms whether event.sessionId exists or not
    console.log("[Phase0] tool_call event structure:", JSON.stringify({
      type: event.type,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      hasSessionId: "sessionId" in event,
      allKeys: Object.keys(event),
    }, null, 2));

    logVerification("tool_call event captured", `toolName=${event.toolName}, keys=${Object.keys(event).join(",")}`);

    // --- Verification 2: sessionId isolation via ctx.sessionManager ---
    // Confirm that ctx.sessionManager is available and getSessionId() works
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionDir = ctx.sessionManager.getSessionDir();

    console.log("[Phase0] Session identification:", JSON.stringify({
      sessionId,
      sessionFile,
      sessionDir,
    }, null, 2));

    logVerification("sessionId via sessionManager", sessionId);
    logVerification("sessionFile via sessionManager", sessionFile ?? "undefined");

    // --- Verification 3: Block strategy ---
    // Demonstrate blocking a dangerous command (without actually blocking normal operation)
    // Example: block any command containing "rm -rf /"
    if (event.toolName === "bash" && typeof event.input === "object" && event.input !== null) {
      const input = event.input as { command?: string };
      if (input.command && input.command.includes("rm -rf /")) {
        logVerification("block strategy", `BLOCKED: ${input.command}`);
        return { block: true, reason: "Blocked by Word AI safety gate: destructive command" };
      }
    }

    // --- Verification 4: Non-matching tools return undefined ---
    // For tools we don't handle, return undefined to let them proceed normally
    return undefined;
  });

  // ================================================================
  // Custom Tool: hello
  // Verifies: pi.registerTool(), tool execute with ctx, shared services
  // ================================================================
  pi.registerTool({
    name: "hello",
    label: "Hello",
    description: "Say hello and verify Word AI extension is working. Use when you want to test the Word AI extension.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Name to greet (default: World)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const name = (params.name as string) ?? "World";

      // Verify shared services are accessible from within a tool
      if (!services) {
        return {
          content: [{ type: "text" as const, text: "Error: Services not initialized. Session may not have started." }],
          details: { error: "SERVICES_NOT_INITIALIZED" },
        };
      }

      // Verify sessionId is accessible from tool's ctx
      const sessionId = ctx.sessionManager.getSessionId();

      // Demonstrate streaming update
      onUpdate?.({
        content: [{ type: "text" as const, text: `Preparing greeting...` }],
        details: { progress: 50 },
      });

      // Check for cancellation
      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled" }],
          details: { cancelled: true },
        };
      }

      logVerification("hello tool executed", `name=${name}, sessionId=${sessionId}`);

      return {
        content: [{ type: "text" as const, text: `Hello, ${name}! Word AI Phase 0 extension is operational.` }],
        details: {
          sessionId,
          repositoryType: services.repository.constructor.name,
          toolCallId,
        },
      };
    },
  });

  // ================================================================
  // Custom Tool: echo
  // Verifies: pi.registerTool(), parameter schema, streaming response
  // ================================================================
  pi.registerTool({
    name: "echo",
    label: "Echo",
    description: "Echo back the provided message. Use to test Word AI tool parameter passing and response.",
    parameters: Type.Object({
      message: Type.String({ description: "Message to echo back" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const message = params.message as string;
      const sessionId = ctx.sessionManager.getSessionId();

      // Demonstrate streaming with multiple updates
      onUpdate?.({
        content: [{ type: "text" as const, text: "Receiving message..." }],
        details: { progress: 33 },
      });

      onUpdate?.({
        content: [{ type: "text" as const, text: "Processing..." }],
        details: { progress: 66 },
      });

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled" }],
          details: { cancelled: true },
        };
      }

      logVerification("echo tool executed", `message=${message}, sessionId=${sessionId}`);

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          sessionId,
          length: message.length,
          toolCallId,
        },
      };
    },
  });

  // ================================================================
  // Custom Tool: phase0_status
  // Verifies: tool that reports Phase 0 verification results
  // ================================================================
  pi.registerTool({
    name: "phase0_status",
    label: "Phase 0 Status",
    description: "Report the current Phase 0 verification status. Use to check which architecture validations have passed.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const report = verificationLog.length > 0
        ? verificationLog.map((e, i) => `${i + 1}. ${e}`).join("\n")
        : "No verification events recorded yet. Try calling hello or echo first.";

      return {
        content: [{ type: "text" as const, text: `Phase 0 Verification Report:\n\n${report}` }],
        details: {
          totalChecks: verificationLog.length,
          servicesActive: services !== null,
        },
      };
    },
  });

  // ================================================================
  // Command: /phase0
  // Quick way to check Phase 0 status from the command line
  // ================================================================
  pi.registerCommand("phase0", {
    description: "Show Phase 0 verification status",
    handler: async (_args, ctx) => {
      const count = verificationLog.length;
      ctx.ui.notify(`Phase 0: ${count} verification checks logged. Use phase0_status tool for details.`, "info");
    },
  });
}
