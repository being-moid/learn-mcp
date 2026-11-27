import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { HubEventBus } from "./event-bus";
import { createServer } from "./server";

// The Durable Object class must be exported from the Worker's main module.
export { NotificationHub } from "./notification-hub";

// Why not Cloudflare's createMcpHandler (agents/mcp/server) any more?
// Change notifications need a shared event bus that works across requests
// (see notification-hub.ts), and Cloudflare's wrapper doesn't let us supply
// one. So we use the MCP SDK's own createMcpHandler, which takes a `bus`, and
// add back the three protections the wrapper gave us (route, Host/Origin
// checks, CORS) in guard() below.
//
// Created once, when the Worker starts. The handler holds no request data:
// for every request it calls the factory to build a fresh McpServer. The
// factory closes over `handler` (for handler.notify), which is safe because it
// only runs on a request, after this line.
const handler = createMcpHandler(() => createServer(handler.notify), {
  bus: new HubEventBus(),
  // 2025-era clients (an initialize handshake, no _meta) are still served,
  // statelessly, from the same factory.
  legacy: "stateless",
  onerror: (err) => console.warn(JSON.stringify({ mcpHandlerError: err.message })),
});

const ROUTE = "/mcp";

// CORS, as Cloudflare's wrapper sent it: lets browser-based tools such as the
// MCP Inspector call the server. CORS is not authentication.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The checks the MCP spec asks for in front of an HTTP server. A Host header
// that isn't ours, or a browser Origin from another site, is refused, which
// protects against DNS-rebinding attacks from a web page.
function guard(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return new Response("Not found. The MCP endpoint is /mcp.", { status: 404 });

  // The same rule Cloudflare's wrapper uses: check the Host header on local
  // dev and on our *.workers.dev address. (A custom domain would list its
  // hostnames here.)
  const local = localhostAllowedHostnames().includes(url.hostname);
  const workersDev = url.hostname.endsWith(".workers.dev");
  const allowedHosts = local ? localhostAllowedHostnames() : workersDev ? [url.hostname] : undefined;
  const hostRejection = allowedHosts ? hostHeaderValidationResponse(request, allowedHosts) : undefined;

  const allowedOrigins = [...localhostAllowedOrigins(), ...(workersDev ? [url.hostname] : [])];
  return hostRejection ?? originValidationResponse(request, allowedOrigins);
}

export default {
  async fetch(request) {
    const rejected = guard(request);
    if (rejected) return withCors(rejected);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    return withCors(await handler.fetch(request));
  },
} satisfies ExportedHandler<Env>;
