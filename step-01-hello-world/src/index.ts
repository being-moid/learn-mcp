import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";

// Created once, when the Worker starts. The handler holds no request data:
// for every request it calls createServer() to build a fresh McpServer.
// Keeping it at module level is what lets `handler.notify` reach open
// streams in later steps.
const handler = createMcpHandler(createServer, { route: "/mcp" });

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("Not found. The MCP endpoint is /mcp.", { status: 404 });
    }
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
