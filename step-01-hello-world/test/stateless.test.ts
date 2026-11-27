import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const PROTOCOL_VERSION = "2026-07-28";

// One stateless MCP request, as a 2026-07-28 client sends it: no initialize
// handshake and no session header. The protocol version and the client's
// capabilities travel with every request, in headers and in params._meta.
function callGreet(id: number, name: string): Promise<Response> {
  return exports.default.fetch("https://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "greet",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "greet",
        arguments: { name },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "stateless-test", version: "0.0.0" },
        },
      },
    }),
  });
}

// The server may answer with plain JSON or with a short SSE stream.
// Either way, pull out the JSON-RPC message that carries the result.
async function readResult(res: Response): Promise<any> {
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)))
        .find((msg) => "result" in msg || "error" in msg)
    : JSON.parse(text);
  return json;
}

describe("stateless /mcp", () => {
  it("answers 20 concurrent greet calls, each with its own name", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `Customer-${i + 1}`);

    const responses = await Promise.all(names.map((name, i) => callGreet(i + 1, name)));
    const messages = await Promise.all(responses.map(readResult));

    messages.forEach((msg, i) => {
      expect(responses[i].status).toBe(200);
      expect(msg.error, JSON.stringify(msg.error)).toBeUndefined();
      expect(msg.id).toBe(i + 1);
      expect(msg.result.structuredContent.greeting).toBe(`Hello, ${names[i]}! Welcome to Stockroom.`);
      // No other request's name may appear in this response.
      for (const other of names) {
        if (other !== names[i]) expect(msg.result.content[0].text).not.toContain(`${other}!`);
      }
    });
  });

  it("returns 404 outside /mcp", async () => {
    const res = await exports.default.fetch("https://example.com/");
    expect(res.status).toBe(404);
  });
});
