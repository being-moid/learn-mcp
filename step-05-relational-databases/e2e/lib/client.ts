import { HmacInvitationLinkTokens } from "../../src/infrastructure/auth/hmac-invitation-link-tokens";
import { baseUrl, invitationSecret, tag, testEmail } from "./config.ts";
import { confirmEmail } from "./d1.ts";

// A test user driving the real server over HTTPS, the way a browser and an
// MCP client (Claude, ChatGPT) do: sign-up and sign-in with cookies, the
// OAuth flow (DCR, PKCE S256, resource, consent, token), then MCP calls with
// the access token.

const REDIRECT_URI = "https://client.example.com/callback";
const PROTOCOL_VERSION = "2026-07-28";
export const PASSWORD = "e2e-Correct-Horse-Battery-1";

/** One browser: its cookies, and HTTP helpers that send them. */
export class Browser {
  private readonly cookies = new Map<string, string>();

  async call(path: string, init: RequestInit = {}): Promise<Response> {
    // Every request in CI comes from one runner IP, so Better Auth's sign-up
    // and sign-in rate limits are reached quickly. Wait as long as the server
    // says (Retry-After) and try again, rather than failing the run.
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("origin", baseUrl());
      if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const response = await fetch(path.startsWith("http") ? path : `${baseUrl()}${path}`, { ...init, headers, redirect: "manual" });
      if (response.status === 429 && attempt < 6) {
        const wait = Number(response.headers.get("x-retry-after") ?? response.headers.get("retry-after") ?? 10);
        await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1), 30) * 1000));
        continue;
      }
      this.take(response.headers.getSetCookie());
      return response;
    }
  }

  take(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair] = header.split(";");
      const eq = pair.indexOf("=");
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  post(path: string, body: unknown): Promise<Response> {
    return this.call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async json(path: string, body?: unknown): Promise<any> {
    const response = body === undefined ? await this.call(path) : await this.post(path, body);
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
}

export interface User {
  label: string;
  email: string;
  userId: string;
  browser: Browser;
}

/** Signs up a tagged test user, confirms their email (as the link would), and signs in. */
export async function signUp(label: string): Promise<User> {
  const email = testEmail(label);
  const browser = new Browser();
  const created = await browser.json("/api/auth/sign-up/email", { name: `${tag()}${label}`, email, password: PASSWORD });
  confirmEmail(email);
  await browser.json("/api/auth/sign-in/email", { email, password: PASSWORD });
  return { label, email, userId: created.user.id, browser };
}

/** Signs in an existing user in a fresh browser. */
export async function signIn(label: string, email: string, userId: string): Promise<User> {
  const browser = new Browser();
  await browser.json("/api/auth/sign-in/email", { email, password: PASSWORD });
  return { label, email, userId, browser };
}

/** The organizations the user belongs to, from Better Auth. */
export async function organizationsOf(user: User): Promise<{ id: string; name: string }[]> {
  return user.browser.json("/api/auth/organization/list");
}

/** The invitation link's secret, as the emailed link carries it (staging only: needs the staging secret). */
export async function invitationToken(invitationId: string): Promise<string> {
  const secret = invitationSecret();
  if (!secret) throw new Error("E2E_INVITATION_SECRET isn't set: it's needed to follow invitation links on staging");
  return new HmacInvitationLinkTokens(async () => secret).tokenFor(invitationId);
}

/** Joins from an invitation link by choosing only a password; returns the signed-in user. */
export async function joinByInvitation(label: string, invitationId: string): Promise<User> {
  const browser = new Browser();
  const token = await invitationToken(invitationId);
  const joined = await browser.json("/invitations/join", { invitationId, token, password: PASSWORD });
  const session = await browser.json("/api/auth/get-session");
  return { label, email: joined.email, userId: session.user.id, browser };
}

/** Registers an OAuth client (DCR), named with the run's tag so cleanup can find it. */
export async function registerClient(): Promise<string> {
  const client = await new Browser().json("/api/auth/oauth2/register", {
    client_name: `${tag()}client`,
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
  return client.client_id;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(new Uint8Array(bytes)).toString("base64url");
}

function signedQuery(url: URL): string {
  const names = new Set(url.searchParams.getAll("ba_param"));
  const signed = new URLSearchParams();
  for (const [key, value] of url.searchParams) if (key === "sig" || key === "ba_param" || names.has(key)) signed.append(key, value);
  return signed.toString();
}

/** authorize -> [pick organization] -> consent -> token, as Claude does; returns the access token. */
export async function accessToken(user: User, clientId: string, pick?: string): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const mcp = `${baseUrl()}/mcp`;
  const authorize = new URL(`${baseUrl()}/api/auth/oauth2/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, scope: "openid",
    state: crypto.randomUUID(), code_challenge: challenge, code_challenge_method: "S256", resource: mcp,
  })) authorize.searchParams.set(k, v);

  // A browser navigates here and asks for HTML, which is what makes Better
  // Auth answer with a redirect (to a fetch() it answers in JSON).
  const first = await user.browser.call(authorize.toString(), { headers: { accept: "text/html" } });
  // It answers with a redirect, or (to a request that looks like fetch) with
  // JSON { redirect: true, url }, which the sign-in page script follows.
  const next = first.headers.get("location") ?? (first.status === 200 ? ((await first.clone().json().catch(() => ({}))) as { url?: string }).url : undefined);
  let location = new URL(next ?? "", baseUrl());
  if (location.pathname === "/select-organization") {
    if (!pick) throw new Error(`${user.label} was sent to the organization picker, but no organization to pick was given`);
    await user.browser.json("/api/auth/organization/set-active", { organizationId: pick });
    location = new URL((await user.browser.json("/api/auth/oauth2/continue", { postLogin: true, oauth_query: signedQuery(location) })).url, baseUrl());
  }
  if (location.pathname === "/consent") {
    location = new URL((await user.browser.json("/api/auth/oauth2/consent", { accept: true, oauth_query: signedQuery(location) })).url, baseUrl());
  }
  const code = location.searchParams.get("code");
  if (!code) {
    const body = first.status === 200 ? (await first.text()).slice(0, 300) : "";
    throw new Error(`${user.label}: no authorization code; ended at ${location.pathname} (HTTP ${first.status}) ${body}`);
  }

  const response = await fetch(`${baseUrl()}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: mcp }),
  });
  const token = (await response.json()) as { access_token?: string };
  if (!response.ok || !token.access_token) throw new Error(`${user.label}: token exchange failed (HTTP ${response.status})`);
  return token.access_token;
}

let nextId = 1;

/** One stateless MCP request (2026-07-28: no initialize, no session). Returns the HTTP status and message. */
export async function mcp(token: string | undefined, method: string, params: Record<string, unknown> = {}, name?: string): Promise<{ status: number; message: any }> {
  const id = nextId++;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    "mcp-method": method,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (name) headers["mcp-name"] = name;
  const meta = {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "stockroom-e2e", version: "0.0.0" },
  };
  const response = await fetch(`${baseUrl()}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }) });
  const text = await response.text();
  if (response.status !== 200) return { status: response.status, message: text };
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))).find((m) => m.id === id)
    : JSON.parse(text);
  return { status: 200, message: json };
}

/** Calls a tool; returns its result (isError for refusals), throwing on transport or protocol errors. */
export async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const { status, message } = await mcp(token, "tools/call", { name, arguments: args }, name);
  if (status !== 200) throw new Error(`${name}: HTTP ${status} ${String(message).slice(0, 200)}`);
  if (message.error) throw new Error(`${name}: JSON-RPC error ${JSON.stringify(message.error)}`);
  return message.result;
}

/** The text of a tool result, for asserting on refusal messages. */
export const textOf = (result: any): string => (result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
