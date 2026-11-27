import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MCP_URL, sharedAccount } from "../helpers/oauth";

// src/http/guard.ts re-adds the protections Cloudflare's wrapper gave us
// (we use the MCP SDK handler directly); these tests check they hold.

const listBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
const jsonHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

describe("HTTP guard", () => {
  it("answers a CORS preflight from a local tool (MCP Inspector) with its own origin, never *", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-04.example.workers.dev/mcp", {
      method: "OPTIONS",
      headers: { host: "learn-mcp-step-04.example.workers.dev", origin: "http://localhost:6274" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:6274");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Method");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("sends no CORS headers to server-to-server calls (no Origin), as Claude and ChatGPT make", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-04.example.workers.dev/.well-known/oauth-protected-resource/mcp", {
      headers: { host: "learn-mcp-step-04.example.workers.dev" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a browser request from another site's Origin", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-04.example.workers.dev/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, host: "learn-mcp-step-04.example.workers.dev", origin: "https://evil.example" },
      body: listBody,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a workers.dev request whose Host header isn't ours", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-04.example.workers.dev/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, host: "attacker.example" },
      body: listBody,
    });
    expect(res.status).toBe(403);
  });

  it("still serves 2025-era clients (initialize handshake, no _meta)", async () => {
    const { token } = await sharedAccount();
    const res = await exports.default.fetch(MCP_URL, {
      method: "POST",
      headers: { ...jsonHeaders, "mcp-protocol-version": "2025-06-18", host: new URL(MCP_URL).host, authorization: `Bearer ${token}` },
      body: listBody,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("create_note");
  });
});
