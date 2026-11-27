import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// What MCP clients (Claude, ChatGPT) look for before signing a user in.
const BASE = "https://learn-mcp-step-05.example.workers.dev";
const get = (path: string) => exports.default.fetch(`${BASE}${path}`, { headers: { host: new URL(BASE).host } });

describe("OAuth discovery", () => {
  it("publishes protected-resource metadata for /mcp at both well-known paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const metadata = (await res.json()) as Record<string, unknown>;
      // Claude requires `resource` to equal the URL the user enters, exactly.
      expect(metadata.resource).toBe(`${BASE}/mcp`);
      // Claude uses only the first authorization server.
      expect(metadata.authorization_servers).toEqual([`${BASE}/api/auth`]);
    }
  });

  it("publishes authorization-server metadata where MCP clients look for a path issuer", async () => {
    const res = await get("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as Record<string, unknown>;
    expect(metadata.issuer).toBe(`${BASE}/api/auth`);
    // Claude uses CIMD only when both of these are advertised; otherwise it falls back to DCR.
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
    // Claude always uses PKCE with S256.
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    // DCR stays available as the fallback the spec still allows.
    expect(metadata.registration_endpoint).toBe(`${BASE}/api/auth/oauth2/register`);
  });
});
