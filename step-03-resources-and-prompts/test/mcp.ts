import { exports } from "cloudflare:workers";

const PROTOCOL_VERSION = "2026-07-28";
let nextId = 1;

const META = {
  "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "notes-test", version: "0.0.0" },
};

// Builds one stateless MCP request, as a 2026-07-28 client does: no
// initialize handshake and no session header. The protocol version and the
// client's capabilities travel with every request, in headers and _meta.
// `name` fills the Mcp-Name header, which mirrors params.name (tools, prompts)
// or params.uri (resources).
export function mcpRequest(method: string, params: Record<string, unknown>, name?: string): { id: number; request: Request } {
  const id = nextId++;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    "mcp-method": method,
  };
  if (name) headers["mcp-name"] = name;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META } });
  return { id, request: new Request("https://example.com/mcp", { method: "POST", headers, body }) };
}

/** Sends one request and returns its JSON-RPC message (result or error). */
export async function rpc(method: string, params: Record<string, unknown> = {}, name?: string): Promise<any> {
  const { id, request } = mcpRequest(method, params, name);
  const res = await exports.default.fetch(request);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const msg = await readMessage(res);
  if (msg.id !== id) throw new Error(`Response id ${msg.id} does not match request id ${id}`);
  return msg;
}

/** Calls a tool and returns its result, throwing on a JSON-RPC error. */
export async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const msg = await rpc("tools/call", { name, arguments: args }, name);
  if (msg.error) throw new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

// The server may answer with plain JSON or with a short SSE stream.
async function readMessage(res: Response): Promise<any> {
  const text = await res.text();
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(text);
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)))
    .find((msg) => "result" in msg || "error" in msg);
}
