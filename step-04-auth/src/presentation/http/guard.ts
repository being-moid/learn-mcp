import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

// The protections Cloudflare's MCP wrapper used to give us, re-added because
// we now use the MCP SDK's handler directly (see presentation/mcp/handler.ts).

// CORS: lets browser-based tools such as the MCP Inspector (on localhost)
// call the server. CORS is not authentication. It names the caller's own
// origin, never "*", and only after rejectForeignHostOrOrigin has accepted
// that origin (localhost or this site). Requests without an Origin header,
// such as Claude's and ChatGPT's servers, get no CORS headers: they don't
// need them. Credentials (cookies) are never allowed cross-origin.
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Adds CORS headers for an origin the guard already accepted. */
export function withCors(response: Response, request: Request): Response {
  const cors = corsHeaders(request);
  if (!Object.keys(cors).length) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
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
