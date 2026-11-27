import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeMetadataUrl, UnsafeMetadataUrlError, workersMetadataFetch } from "../../../../src/infrastructure/auth/cimd-fetch";

describe("CIMD metadata transport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a public HTTPS URL", () => {
    expect(() => assertSafeMetadataUrl(new URL("https://claude.ai/oauth/mcp-oauth-client-metadata"))).not.toThrow();
  });

  it.each([
    "http://claude.ai/metadata",
    "https://127.0.0.1/metadata",
    "https://10.0.0.5/metadata",
    "https://[::1]/metadata",
    "https://localhost/metadata",
    "https://printer.local/metadata",
    "https://intranet/metadata",
    "https://user:pass@claude.ai/metadata",
    "https://claude.ai:8443/metadata",
  ])("refuses %s", (url) => {
    expect(() => assertSafeMetadataUrl(new URL(url))).toThrow(UnsafeMetadataUrlError);
  });

  it("refuses to follow a redirect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }));
    await expect(workersMetadataFetch("https://client.example.com/metadata")).rejects.toThrow(/must not redirect/);
  });

  it("refuses an oversized document", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x".repeat(70 * 1024), { status: 200 }));
    await expect(workersMetadataFetch("https://client.example.com/metadata")).rejects.toThrow(/too large/);
  });
});
