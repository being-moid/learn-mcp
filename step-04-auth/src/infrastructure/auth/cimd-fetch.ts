// The fetch transport Better Auth's CIMD plugin uses to download a client's
// Client ID Metadata Document (the client_id is a URL, e.g. Claude's).
//
// CIMD's contract: no redirects, no special-use or private addresses, and a
// bounded fetch. On Cloudflare Workers, outbound fetch() leaves from
// Cloudflare's edge to the public internet, so it can't reach this Worker's
// own network or a private LAN, and DNS is resolved by Cloudflare. On top of
// that we refuse anything that isn't a plain public HTTPS name, refuse every
// redirect, and cap time and size.

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

/** Host names that must never be fetched, whatever DNS says. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".test", ".invalid", ".example"];

export class UnsafeMetadataUrlError extends Error {}

/** Throws UnsafeMetadataUrlError unless `url` is an HTTPS URL on a public host name. */
export function assertSafeMetadataUrl(url: URL): void {
  if (url.protocol !== "https:") throw new UnsafeMetadataUrlError("Client metadata must be served over HTTPS");
  if (url.username || url.password) throw new UnsafeMetadataUrlError("Client metadata URLs must not contain credentials");
  if (url.port && url.port !== "443") throw new UnsafeMetadataUrlError("Client metadata must use the default HTTPS port");
  const host = url.hostname.toLowerCase();
  // IP literals (v4, or v6 in brackets) are refused outright: a real client
  // publishes its metadata under a domain name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":")) {
    throw new UnsafeMetadataUrlError("Client metadata URLs must use a host name, not an IP address");
  }
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeMetadataUrlError("Client metadata URLs must use a public host name");
  }
}

/** A fetch-shaped transport (what `cimd({ fetchClientMetadataResource })` expects). */
export async function workersMetadataFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assertSafeMetadataUrl(url);

  const response = await fetch(url, {
    ...init,
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new UnsafeMetadataUrlError("Client metadata URLs must not redirect");
  }

  // Read at most MAX_BYTES so a huge document can't exhaust memory.
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new UnsafeMetadataUrlError("Client metadata document is too large");
  const body = await readCapped(response, MAX_BYTES);
  return new Response(body, { status: response.status, headers: response.headers });
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeMetadataUrlError("Client metadata document is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
