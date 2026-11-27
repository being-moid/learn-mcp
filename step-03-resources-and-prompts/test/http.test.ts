import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// index.ts replaced Cloudflare's wrapper with the SDK handler plus guard(),
// so these tests check that the wrapper's protections are still in place.

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
    const res = await exports.default.fetch("https://learn-mcp-step-03.example.workers.dev/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, host: "learn-mcp-step-03.example.workers.dev", origin: "https://evil.example" },
      body: listBody,
    });
    expect(res.status).toBe(403);
  });

  it("refuses a workers.dev request whose Host header isn't ours", async () => {
    const res = await exports.default.fetch("https://learn-mcp-step-03.example.workers.dev/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, host: "attacker.example" },
      body: listBody,
    });
    expect(res.status).toBe(403);
  });

  it("still serves 2025-era clients (initialize handshake, no _meta)", async () => {
    const res = await exports.default.fetch("https://example.com/mcp", {
      method: "POST",
      headers: { ...jsonHeaders, "mcp-protocol-version": "2025-06-18" },
      body: listBody,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("create_note");
  });
});
