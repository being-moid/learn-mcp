import { exports } from "cloudflare:workers";

const PROTOCOL_VERSION = "2026-07-28";
let nextId = 1;

// Sends one stateless MCP tools/call request, as a 2026-07-28 client does:
// no initialize handshake and no session header. The protocol version and
// the client's capabilities travel with every request, in headers and _meta.
export async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const id = nextId++;
  const res = await exports.default.fetch("https://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "notes-test", version: "0.0.0" },
        },
      },
    }),
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const msg = await readMessage(res);
  if (msg.id !== id) throw new Error(`Response id ${msg.id} does not match request id ${id}`);
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
