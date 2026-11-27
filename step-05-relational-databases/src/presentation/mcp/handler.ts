import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServices, selectEventBus } from "../../composition";
import { callerFromAuthInfo } from "./auth-info";
import { createServer } from "./server";

// Why not Cloudflare's createMcpHandler (agents/mcp/server)?
// Change notifications need a shared event bus that works across requests
// (see infrastructure/notifications/hub.ts), and Cloudflare's wrapper doesn't let us supply
// one. So we use the MCP SDK's own createMcpHandler, which takes a `bus`, and
// presentation/http/guard.ts adds back the wrapper's Host/Origin checks and CORS.
//
// Created once, when the Worker starts. The handler holds no request data:
// for every request it calls the factory, which reads the caller (set by the
// auth and access checks in index.ts), builds that request's services
// (composition root) and a fresh McpServer.
export const mcpHandler = createMcpHandler(
  (ctx) => {
    const { principal, membership } = callerFromAuthInfo(ctx.authInfo);
    return createServer(buildServices(principal, membership));
  },
  {
    bus: selectEventBus(),
    // 2025-era clients (an initialize handshake, no _meta) are still served,
    // statelessly, from the same factory.
    legacy: "stateless",
    onerror: (err) => console.warn(JSON.stringify({ mcpHandlerError: err.message })),
  },
);
