import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

// The protections Cloudflare's MCP wrapper used to give us, re-added because
// we now use the MCP SDK's handler directly (see presentation/mcp/handler.ts).

// CORS, as Cloudflare's wrapper sent it: lets browser-based tools such as the
// MCP Inspector call the server. CORS is not authentication.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The checks the MCP spec asks for in front of an HTTP server. A Host header
 * that isn't ours, or a browser Origin from another site, is refused, which
 * protects against DNS-rebinding attacks from a web page. Returns a rejection
 * response, or undefined when the request may continue.
 */
export function rejectForeignHostOrOrigin(request: Request): Response | undefined {
  const url = new URL(request.url);

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
