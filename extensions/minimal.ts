import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  console.log("[minimal-ext] Extension factory called");

  pi.on("session_start", async (_event, ctx) => {
    console.log("[minimal-ext] session_start triggered");
    console.log("[minimal-ext] sessionId:", ctx.sessionManager.getSessionId());
    if (ctx.hasUI) {
      ctx.ui.notify("Minimal extension loaded!", "info");
    }
  });

  pi.on("session_shutdown", async () => {
    console.log("[minimal-ext] session_shutdown triggered");
  });

  pi.registerTool({
    name: "ping",
    label: "Ping",
    description: "A minimal ping tool for testing extension loading. Use when you want to test if the extension works.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      return {
        content: [{ type: "text" as const, text: `pong! session=${sessionId}` }],
        details: { sessionId },
      };
    },
  });
}
