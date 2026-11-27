import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { RecordingEmailSender } from "../../../src/infrastructure/email/recording-email-sender";
import { callTool } from "../helpers/mcp";
import { env } from "cloudflare:workers";
import { BASE, createAccount, issueAccessToken, linkIn, registerClient, waitForEmail } from "../helpers/oauth";

const headers = { "content-type": "application/json", host: new URL(BASE).host, origin: BASE };

/** Signs up (without confirming) and returns the browser's cookie header once signed in, if `confirm`. */
async function signUp(email: string, confirm: boolean): Promise<string> {
  await exports.default.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { ...headers, "cf-connecting-ip": "192.0.2.10" },
    body: JSON.stringify({ name: "Invitee", email, password: "correct-horse-battery" }),
  });
  if (!confirm) return "";
  const verified = await exports.default.fetch(linkIn(await waitForEmail(email)), { headers: { host: new URL(BASE).host }, redirect: "manual" });
  return verified.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const accept = (invitationId: string, cookie: string) =>
  exports.default.fetch(`${BASE}/api/auth/organization/accept-invitation`, {
    method: "POST",
    headers: { ...headers, cookie },
    body: JSON.stringify({ invitationId }),
  });

async function ownerInvites(email: string) {
  const owner = await createAccount("Inviter");
  const token = await issueAccessToken(owner, await registerClient());
  const invited = await callTool("invite_member", { email }, token);
  expect(invited.isError).toBeFalsy();
  return { owner, token, invitationId: invited.structuredContent.invitationId as string };
}

describe("inviting members", () => {
  it("emails an invitation from the invitations address with a working accept link", async () => {
    const email = `invitee-${crypto.randomUUID()}@example.com`;
    const { invitationId } = await ownerInvites(email);
    const message = await waitForEmail(email);
    expect(message.category).toBe("invitation");
    expect(message.subject).toMatch(/invited you to Inviter's company on Stockroom/);
    // The secret token is after "#", so it never reaches the server (or its logs).
    expect(linkIn(message)).toMatch(new RegExp(`^${BASE}/accept-invitation\\?id=${invitationId}#token=[A-Za-z0-9_-]{43}$`));
    const page = await exports.default.fetch(linkIn(message), { headers: { host: new URL(BASE).host } });
    expect(page.status).toBe(200);
  });

  it("doesn't email again when the same address is invited twice", async () => {
    const email = `twice-${crypto.randomUUID()}@example.com`;
    const { token, invitationId } = await ownerInvites(email);
    await waitForEmail(email);
    const again = await callTool("invite_member", { email }, token);
    expect(again.structuredContent).toMatchObject({ invitationId, reused: true });
    await new Promise((r) => setTimeout(r, 200)); // give a (wrong) second send time to happen
    expect(RecordingEmailSender.sent.filter((m) => m.to === email)).toHaveLength(1);
  });

  it("lets the invitee join after confirming their email, as a Member", async () => {
    const email = `joiner-${crypto.randomUUID()}@example.com`;
    const { token, invitationId } = await ownerInvites(email);
    const cookie = await signUp(email, true);
    expect((await accept(invitationId, cookie)).status).toBe(200);

    const members = await callTool("list_company_members", {}, token);
    expect(members.structuredContent.members.find((m: { email: string }) => m.email === email)?.role.name).toBe("Member");
  });

  it("won't let someone with a different email accept the invitation", async () => {
    const { invitationId } = await ownerInvites(`intended-${crypto.randomUUID()}@example.com`);
    const cookie = await signUp(`attacker-${crypto.randomUUID()}@example.com`, true);
    expect((await accept(invitationId, cookie)).status).toBeGreaterThanOrEqual(400);
  });

  it("won't let an unconfirmed account claim the invited address", async () => {
    const email = `claimed-${crypto.randomUUID()}@example.com`;
    const { invitationId } = await ownerInvites(email);
    // An attacker signs up with the invited address but can't confirm it:
    // they have no session, and signing in is refused until confirmed.
    await signUp(email, false);
    const signIn = await exports.default.fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.11" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    expect(signIn.status).toBe(403);
    expect((await accept(invitationId, "")).status).toBeGreaterThanOrEqual(400);
  });

  it("refuses invite_member to a Member", async () => {
    const owner = await createAccount("Boss");
    const { addMember } = await import("../helpers/oauth");
    const member = await addMember(owner, "Staff");
    const memberToken = await issueAccessToken(member, await registerClient(), owner.organizationId);
    const result = await callTool("invite_member", { email: "someone@example.com" }, memberToken);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"members:invite" permission');
  });

});

/** The invitation ID and secret token from the emailed link. */
async function emailedLink(email: string): Promise<{ invitationId: string; token: string }> {
  // Wait for the invitation itself (an existing account also has its old confirmation email).
  const deadline = Date.now() + 3_000;
  let message = RecordingEmailSender.sent.findLast((m) => m.to === email && m.category === "invitation");
  while (!message && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    message = RecordingEmailSender.sent.findLast((m) => m.to === email && m.category === "invitation");
  }
  if (!message) throw new Error(`No invitation email to ${email}`);
  const url = new URL(linkIn(message));
  return { invitationId: url.searchParams.get("id")!, token: new URLSearchParams(url.hash.slice(1)).get("token")! };
}

const invitationPost = (path: string, body: unknown) =>
  exports.default.fetch(`${BASE}${path}`, { method: "POST", headers: { ...headers, "cf-connecting-ip": "192.0.2.20" }, body: JSON.stringify(body) });

describe("joining from an invitation by choosing only a password", () => {
  it("shows who invited them and that they have no account yet", async () => {
    const email = `preview-${crypto.randomUUID()}@example.com`;
    await ownerInvites(email);
    const res = await invitationPost("/invitations/preview", await emailedLink(email));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email, organizationName: "Inviter's company", inviterName: "Inviter", role: "member", hasAccount: false });
  });

  it("creates a confirmed account in the inviting company only, signs them in, and sends no second email", async () => {
    const email = `newbie-${crypto.randomUUID()}@example.com`;
    const { owner, token: ownerToken } = await ownerInvites(email);
    const link = await emailedLink(email);

    const res = await invitationPost("/invitations/join", { ...link, password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email, organizationName: "Inviter's company", signedIn: true });
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);

    const user = await env.AUTH_DB.prepare('SELECT "id", "name", "emailVerified" FROM "user" WHERE "email" = ?').bind(email).first<{ id: string; name: string; emailVerified: number }>();
    expect(user).toMatchObject({ emailVerified: 1, name: email.split("@")[0] });
    const orgs = await env.AUTH_DB.prepare('SELECT "organizationId", "role" FROM "member" WHERE "userId" = ?').bind(user!.id).all();
    expect(orgs.results).toEqual([{ organizationId: owner.organizationId, role: "member" }]); // no company of their own
    expect(await env.AUTH_DB.prepare('SELECT 1 FROM "tenant_admin" WHERE "userId" = ?').bind(user!.id).first()).toBeNull();
    expect(RecordingEmailSender.sent.filter((m) => m.to === email)).toHaveLength(1); // just the invitation

    const members = await callTool("list_company_members", {}, ownerToken);
    expect(members.structuredContent.members.find((m: { email: string }) => m.email === email)?.role.name).toBe("Member");

    // Their password works for a normal sign-in later.
    const signIn = await exports.default.fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.21" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    expect(signIn.status).toBe(200);
  });

  it("works only once", async () => {
    const email = `once-${crypto.randomUUID()}@example.com`;
    await ownerInvites(email);
    const link = await emailedLink(email);
    expect((await invitationPost("/invitations/join", { ...link, password: "correct-horse-battery" })).status).toBe(200);
    expect((await invitationPost("/invitations/join", { ...link, password: "another-password-1" })).status).toBe(404);
    expect((await invitationPost("/invitations/preview", link)).status).toBe(404);
  });

  it("can't be used by the inviter, who knows the invitation ID but not the emailed token", async () => {
    const email = `victim-${crypto.randomUUID()}@example.com`;
    const { invitationId } = await ownerInvites(email);
    for (const token of ["", "guess", "A".repeat(43)]) {
      expect((await invitationPost("/invitations/join", { invitationId, token, password: "attacker-password" })).status).toBe(404);
    }
    expect(await env.AUTH_DB.prepare('SELECT 1 FROM "user" WHERE "email" = ?').bind(email).first()).toBeNull();
  });

  it("sends someone who already has an account to sign in instead", async () => {
    const existing = await createAccount("Existing");
    const owner = await createAccount("Hiring");
    const token = await issueAccessToken(owner, await registerClient());
    expect((await callTool("invite_member", { email: existing.email }, token)).isError).toBeFalsy();
    const link = await emailedLink(existing.email);
    expect(await (await invitationPost("/invitations/preview", link)).json()).toMatchObject({ hasAccount: true });
    const join = await invitationPost("/invitations/join", { ...link, password: "correct-horse-battery" });
    expect(join.status).toBe(400);
    expect(((await join.json()) as { message: string }).message).toMatch(/already has a Stockroom account/);
  });

  it("rejects a short password without using up the invitation", async () => {
    const email = `short-${crypto.randomUUID()}@example.com`;
    await ownerInvites(email);
    const link = await emailedLink(email);
    expect((await invitationPost("/invitations/join", { ...link, password: "short" })).status).toBe(400);
    expect((await invitationPost("/invitations/join", { ...link, password: "correct-horse-battery" })).status).toBe(200);
  });

  it("joins with the invited role (Admin)", async () => {
    const owner = await createAccount("Direct");
    const token = await issueAccessToken(owner, await registerClient());
    const email = `direct-${crypto.randomUUID()}@example.com`;
    expect((await callTool("invite_member", { email, role: "admin" }, token)).isError).toBeFalsy();
    const link = await emailedLink(email);
    expect((await invitationPost("/invitations/join", { ...link, password: "correct-horse-battery" })).status).toBe(200);
    const row = await env.AUTH_DB.prepare('SELECT m."role" FROM "member" m JOIN "user" u ON u."id" = m."userId" WHERE u."email" = ?').bind(email).first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  it("refuses a POST from another site", async () => {
    const res = await exports.default.fetch(`${BASE}/invitations/join`, {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example" },
      body: JSON.stringify({ invitationId: "x", token: "y", password: "z" }),
    });
    expect(res.status).toBe(403);
  });
});
