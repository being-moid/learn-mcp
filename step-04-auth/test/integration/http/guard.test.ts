import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MCP_URL, sharedAccount } from "../helpers/oauth";

// src/http/guard.ts re-adds the protections Cloudflare's wrapper gave us
// (we use the MCP SDK handler directly); these tests check they hold.

const listBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
const jsonHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

describe("HTTP guard", () => {
  it("answers a CORS preflight", async () => {
    const res = await exports.default.fetch("https://example.com/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Method");
  });

  it("refuses a browser request from another site's Origin", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-04.example.workers.dev/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, host: "learn-mcp-step-04.example.workers.dev", origin: "https://evil.example" },
      body: listBody,
    });
    expect(res.status).toBe(403);
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
