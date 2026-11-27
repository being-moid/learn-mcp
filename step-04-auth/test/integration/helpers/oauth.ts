import { env, exports } from "cloudflare:workers";
import type { EmailMessage } from "../../../src/domain/ports/notifications/email-sender";
import { RecordingEmailSender } from "../../../src/infrastructure/email/recording-email-sender";

// Runs the real OAuth flow against the Worker, the way Claude or ChatGPT does,
// so integration tests use genuine, verified access tokens:
//   register a client (DCR) -> sign up (onboarding creates the tenant and a
//   personal organization) -> authorize (PKCE S256, resource = /mcp) ->
//   [pick an organization, if the user has several] -> consent -> token.

export const BASE = "https://learn-mcp-step-04.example.workers.dev";
export const MCP_URL = `${BASE}/mcp`;
const HOST = new URL(BASE).host;
const REDIRECT_URI = "https://client.example.com/callback";

/** One browser: its session cookies, and the IP address Cloudflare would see. */
class CookieJar {
  private readonly cookies = new Map<string, string>();
  /** Each test browser gets its own IP, as real users do, so rate limits apply per user. */
  readonly ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
  take(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const eq = pair.indexOf("=");
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(path: string, init: RequestInit = {}, jar: CookieJar = new CookieJar()): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("host", HOST);
  headers.set("origin", BASE);
  headers.set("cookie", jar.header());
  // Set by Cloudflare in production (and overwritten if a client sends it).
  headers.set("cf-connecting-ip", jar.ip);
  const response = await exports.default.fetch(path.startsWith("http") ? path : `${BASE}${path}`, { ...init, headers, redirect: "manual" });
  jar.take(response);
  return response;
}

async function json(response: Response, what: string): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const postJson = (path: string, body: unknown, jar?: CookieJar) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, jar);

export interface TestAccount {
  email: string;
  userId: string;
  organizationId: string;
  /** The signed-in browser session, for further Better Auth calls. */
  jar: CookieJar;
}

/** Waits for the most recent email to `to` (emails are sent in the background) and returns it. */
export async function waitForEmail(to: string, ms = 3_000): Promise<EmailMessage> {
  const deadline = Date.now() + ms;
  for (;;) {
    const message = RecordingEmailSender.lastTo(to);
    if (message) return message;
    if (Date.now() > deadline) throw new Error(`No email to ${to}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The first link in an email's text. */
export function linkIn(message: EmailMessage): string {
  const url = /https?:\/\/\S+/.exec(message.text)?.[0];
  if (!url) throw new Error(`No link in email "${message.subject}"`);
  return url;
}

/**
 * Signs up a new user and confirms their email address by following the link
 * in the confirmation email, as a real person would; Better Auth then signs
 * them in. Onboarding gives them a tenant and a personal organization, which
 * their session starts on; `organizationId` is that one.
 */
export async function createAccount(name = "Test User"): Promise<TestAccount> {
  const jar = new CookieJar();
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${crypto.randomUUID()}@example.com`;
  const signUp = await json(await postJson("/api/auth/sign-up/email", { name, email, password: "correct-horse-battery" }, jar), "sign-up");
  const verify = await call(linkIn(await waitForEmail(email)), {}, jar);
  if (verify.status >= 400) throw new Error(`Email confirmation failed: HTTP ${verify.status}`);
  const member = await env.AUTH_DB.prepare('SELECT "organizationId" FROM "member" WHERE "userId" = ?').bind(signUp.user.id).first<{ organizationId: string }>();
  if (!member) throw new Error("Onboarding gave the new user no organization");
  return { email, userId: signUp.user.id, organizationId: member.organizationId, jar };
}

/** Gives the user another organization they own (so they belong to several); returns its ID. */
export async function addOrganization(account: TestAccount, name = "Second company"): Promise<string> {
  const organization = await json(
    await postJson("/api/auth/organization/create", { name, slug: `org-${crypto.randomUUID()}`, keepCurrentActiveOrganization: true }, account.jar),
    "create organization",
  );
  return organization.id;
}

/** Registers a public OAuth client, as an MCP client without CIMD would. */
export async function registerClient(): Promise<string> {
  const client = await json(
    await postJson("/api/auth/oauth2/register", {
      client_name: "Test MCP client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
    "client registration",
  );
  return client.client_id;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Takes the signed OAuth parameters from a page URL, as the browser client does. */
function signedQuery(url: URL): string {
  const names = new Set(url.searchParams.getAll("ba_param"));
  const signed = new URLSearchParams();
  for (const [key, value] of url.searchParams) if (key === "sig" || key === "ba_param" || names.has(key)) signed.append(key, value);
  return signed.toString();
}

/**
 * Runs authorize -> [pick organization] -> consent -> token and returns an
 * access token. `pick` is the organization to choose if the user is sent to
 * the picker (they belong to several); the flow fails if they are sent there
 * without one.
 */
export async function issueAccessToken(account: TestAccount, clientId: string, pick?: string): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorize = new URL(`${BASE}/api/auth/oauth2/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    state: crypto.randomUUID(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  })) authorize.searchParams.set(k, v);

  let response = await call(authorize.toString(), {}, account.jar);
  let location = new URL(response.headers.get("location") ?? "", BASE);
  if (location.pathname === "/select-organization") {
    // What the picker page does: make the choice active, then continue.
    if (!pick) throw new Error("Sent to the organization picker, but no organization to pick was given");
    await json(await postJson("/api/auth/organization/set-active", { organizationId: pick }, account.jar), "set active organization");
    const resumed = await json(await postJson("/api/auth/oauth2/continue", { postLogin: true, oauth_query: signedQuery(location) }, account.jar), "continue");
    location = new URL(resumed.url, BASE);
  }
  if (location.pathname === "/consent") {
    const consent = await json(await postJson("/api/auth/oauth2/consent", { accept: true, oauth_query: signedQuery(location) }, account.jar), "consent");
    location = new URL(consent.url, BASE);
  }
  const code = location.searchParams.get("code");
  if (!code) throw new Error(`No authorization code; ended at ${location} (HTTP ${response.status})`);

  response = await call("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: MCP_URL }),
  });
  const token = await json(response, "token exchange");
  return token.access_token;
}

/** A signed-in account and a token for it, created once per test file. */
let shared: Promise<{ account: TestAccount; token: string }> | undefined;
export function sharedAccount(): Promise<{ account: TestAccount; token: string }> {
  shared ??= (async () => {
    const account = await createAccount("Shared");
    return { account, token: await issueAccessToken(account, await registerClient()) };
  })();
  return shared;
}

/** Removes a member from their organization, through Better Auth (as an admin would). */
export async function removeMember(owner: TestAccount, memberIdOrEmail: string): Promise<void> {
  await json(await postJson("/api/auth/organization/remove-member", { memberIdOrEmail, organizationId: owner.organizationId }, owner.jar), "remove member");
}

/**
 * Adds a new user to `owner`'s organization as a member, through Better Auth's
 * invitations (owner invites the address, the new user accepts while signed in).
 * The returned account's organizationId is the owner's organization; the user
 * also has their own personal one from onboarding, so they pick when connecting.
 */
export async function addMember(owner: TestAccount, name: string): Promise<TestAccount> {
  const member = await createAccount(name);
  const invitation = await json(
    await postJson("/api/auth/organization/invite-member", { email: member.email, role: "member", organizationId: owner.organizationId }, owner.jar),
    "invite member",
  );
  await json(await postJson("/api/auth/organization/accept-invitation", { invitationId: invitation.id }, member.jar), "accept invitation");
  return { ...member, organizationId: owner.organizationId };
}

/** An invitation made through Better Auth's own endpoint (with the owner's browser session), not invite_member. */
export async function inviteThroughBetterAuth(owner: TestAccount, email: string, role: "member" | "admin" = "member"): Promise<string> {
  const invitation = await json(await postJson("/api/auth/organization/invite-member", { email, role, organizationId: owner.organizationId }, owner.jar), "invite member");
  return invitation.id as string;
}
