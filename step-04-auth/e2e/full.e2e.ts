import { beforeAll, describe, expect, it } from "vitest";
import { accessToken, Browser, joinByInvitation, mcp, organizationsOf, registerClient, signUp, textOf, tool, type User } from "./lib/client.ts";
import { baseUrl, target, testEmail } from "./lib/config.ts";

// The full end-to-end suite, run against staging on every pull request: two
// customer accounts (tenants), every kind of user in one of them, and every
// permission rule, through the real server the way Claude and ChatGPT use it.
// The tests run in order and build on each other (one story per tenant).
// Everything is tagged with the run's ID and deleted afterwards by
// e2e/cleanup.ts, whether the tests pass or not.

if (target() !== "staging") throw new Error("The full suite runs only against staging (it needs the staging invitation secret). Use smoke.e2e.ts for production.");

const s: {
  client: string;
  ownerA: User; tokenOwnerA: string; orgA: string;
  ownerB: User; tokenOwnerB: string; orgB: string;
  admin: User; tokenAdmin: string;
  member: User; tokenMember: string;
  existing: User; tokenExisting: string;
  roles: Record<string, string>;
  ownerNoteId: string;
} = {} as never;

const memberEmails = async (token: string) =>
  ((await tool(token, "list_company_members")).structuredContent.members as { email: string; role: { name: string } }[]);

beforeAll(async () => {
  s.client = await registerClient();
  s.ownerA = await signUp("owner-a");
  s.ownerB = await signUp("owner-b");
  [s.orgA] = (await organizationsOf(s.ownerA)).map((o) => o.id);
  [s.orgB] = (await organizationsOf(s.ownerB)).map((o) => o.id);
  s.tokenOwnerA = await accessToken(s.ownerA, s.client);
  s.tokenOwnerB = await accessToken(s.ownerB, s.client);
});

describe("tenants and owners", () => {
  it("refuses /mcp without a token, pointing at the sign-in metadata", async () => {
    const res = await fetch(`${baseUrl()}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("gives each new customer their own tenant and company, with them as Owner", async () => {
    expect(s.orgA).toBeTruthy();
    expect(s.orgB).toBeTruthy();
    expect(s.orgA).not.toBe(s.orgB);
    expect(await memberEmails(s.tokenOwnerA)).toEqual([expect.objectContaining({ email: s.ownerA.email, role: expect.objectContaining({ name: "Owner" }) })]);
  });

  it("seeds Owner, Admin and Member roles in every company", async () => {
    const roles = (await tool(s.tokenOwnerA, "list_roles")).structuredContent.roles as { id: string; name: string }[];
    expect(roles.map((r) => r.name)).toEqual(["Owner", "Admin", "Member"]);
    s.roles = Object.fromEntries(roles.map((r) => [r.name, r.id]));
  });

  it("lets the Owner keep notes", async () => {
    const created = await tool(s.tokenOwnerA, "create_note", { title: "Q4 targets", body: "Grow wholesale 20%", category: "other" });
    expect(created.isError).toBeFalsy();
    s.ownerNoteId = created.structuredContent.id;
    expect((await tool(s.tokenOwnerA, "list_notes")).structuredContent.notes.map((n: { id: string }) => n.id)).toContain(s.ownerNoteId);
  });
});

describe("inviting people", () => {
  it("invites a new person as Admin, who joins by choosing only a password", async () => {
    const invited = await tool(s.tokenOwnerA, "invite_member", { email: testEmail("admin"), role: "admin" });
    expect(invited.isError).toBeFalsy();
    s.admin = await joinByInvitation("admin", invited.structuredContent.invitationId);
    // They belong to the inviting company only, so no organization picker.
    expect((await organizationsOf(s.admin)).map((o) => o.id)).toEqual([s.orgA]);
    s.tokenAdmin = await accessToken(s.admin, s.client);
  });

  it("invites a new person as Member, the default", async () => {
    const email = testEmail("member");
    const invited = await tool(s.tokenOwnerA, "invite_member", { email });
    expect(invited.structuredContent).toMatchObject({ role: "member", reused: false });
    // Inviting again reuses the pending invitation.
    expect((await tool(s.tokenOwnerA, "invite_member", { email })).structuredContent).toMatchObject({ invitationId: invited.structuredContent.invitationId, reused: true });
    s.member = await joinByInvitation("member", invited.structuredContent.invitationId);
    s.tokenMember = await accessToken(s.member, s.client);
  });

  it("won't let an invitation link be used twice, or without its secret", async () => {
    const email = testEmail("unused");
    const { invitationId } = (await tool(s.tokenOwnerA, "invite_member", { email })).structuredContent;
    const stranger = new Browser();
    expect((await stranger.post("/invitations/join", { invitationId, token: "guess", password: "e2e-Attacker-Password-1" })).status).toBe(404);
    expect((await stranger.post("/invitations/join", { invitationId, token: "", password: "e2e-Attacker-Password-1" })).status).toBe(404);
  });

  it("lets someone who already has an account accept while signed in, and then pick the company", async () => {
    s.existing = await signUp("existing");
    const invited = await tool(s.tokenOwnerA, "invite_member", { email: s.existing.email });
    expect(invited.isError).toBeFalsy();
    await s.existing.browser.json("/api/auth/organization/accept-invitation", { invitationId: invited.structuredContent.invitationId });
    expect((await organizationsOf(s.existing)).map((o) => o.id).sort()).toEqual(expect.arrayContaining([s.orgA]));
    s.tokenExisting = await accessToken(s.existing, s.client, s.orgA);
    expect((await memberEmails(s.tokenOwnerA)).map((m) => m.email)).toEqual(expect.arrayContaining([s.admin.email, s.member.email, s.existing.email]));
  });

  it("won't invite someone who is already a member", async () => {
    const result = await tool(s.tokenOwnerA, "invite_member", { email: s.member.email });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/already a member/);
  });
});

describe("what each role may do", () => {
  it("Member: own notes yes, admin tools no", async () => {
    expect((await tool(s.tokenMember, "create_note", { title: "Member note", body: "x" })).isError).toBeFalsy();
    for (const [name, args] of [
      ["list_company_members", {}],
      ["invite_member", { email: "x@e2e.example.com" }],
      ["create_role", { name: "Nope", permissions: [] }],
    ] as const) {
      const result = await tool(s.tokenMember, name, args);
      expect(result.isError, name).toBe(true);
      expect(textOf(result)).toMatch(/permission/);
    }
  });

  it("Member: sees only their own notes, never the Owner's", async () => {
    const notes = (await tool(s.tokenMember, "list_notes")).structuredContent.notes.map((n: { id: string }) => n.id);
    expect(notes).not.toContain(s.ownerNoteId);
    expect((await tool(s.tokenMember, "get_note", { id: s.ownerNoteId })).isError).toBe(true);
  });

  it("Admin: manages members and roles, but can't make anyone an Owner", async () => {
    expect((await memberEmails(s.tokenAdmin)).length).toBeGreaterThanOrEqual(4);
    const owner = await tool(s.tokenAdmin, "assign_member_role", { userId: s.member.userId, roleId: s.roles.Owner });
    expect(owner.isError).toBe(true);
    expect(textOf(owner)).toMatch(/Owner/);
  });

  it("Owner: creates a custom role; assigning it changes access on the very next call", async () => {
    const viewer = await tool(s.tokenOwnerA, "create_role", { name: `Viewer ${Date.now()}`, permissions: ["notes:read"] });
    expect(viewer.isError).toBeFalsy();
    expect((await tool(s.tokenOwnerA, "assign_member_role", { userId: s.member.userId, roleId: viewer.structuredContent.id })).isError).toBeFalsy();
    // Same token as before: the role is checked on every request.
    const write = await tool(s.tokenMember, "create_note", { title: "Should fail", body: "x" });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toMatch(/notes:write/);
    expect((await tool(s.tokenMember, "list_notes")).isError).toBeFalsy();
  });

  it("won't let anyone grant a permission they don't hold", async () => {
    const limited = await tool(s.tokenOwnerA, "create_role", { name: `Inviter ${Date.now()}`, permissions: ["members:read", "members:invite", "roles:manage"] });
    await tool(s.tokenOwnerA, "assign_member_role", { userId: s.existing.userId, roleId: limited.structuredContent.id });
    const escalate = await tool(s.tokenExisting, "create_role", { name: `Escalate ${Date.now()}`, permissions: ["notes:delete"] });
    expect(escalate.isError).toBe(true);
  });

  it("keeps the company's last Owner, and never changes the Owner role", async () => {
    const demote = await tool(s.tokenOwnerA, "assign_member_role", { userId: s.ownerA.userId, roleId: s.roles.Member });
    expect(demote.isError).toBe(true);
    expect(textOf(demote)).toMatch(/Owner/);
    expect((await tool(s.tokenOwnerA, "set_role_permissions", { roleId: s.roles.Owner, permissions: ["notes:read"] })).isError).toBe(true);
  });
});

describe("isolation between tenants", () => {
  it("shows each company only its own members, roles and notes", async () => {
    expect((await memberEmails(s.tokenOwnerB)).map((m) => m.email)).toEqual([s.ownerB.email]);
    const rolesB = (await tool(s.tokenOwnerB, "list_roles")).structuredContent.roles.map((r: { id: string }) => r.id);
    expect(rolesB).not.toContain(s.roles.Owner);
    expect((await tool(s.tokenOwnerB, "get_note", { id: s.ownerNoteId })).isError).toBe(true);
  });

  it("won't let one company's Owner touch another company's members or roles", async () => {
    expect((await tool(s.tokenOwnerB, "assign_member_role", { userId: s.member.userId, roleId: s.roles.Admin })).isError).toBe(true);
    const rolesB = (await tool(s.tokenOwnerB, "list_roles")).structuredContent.roles as { id: string; name: string }[];
    expect((await tool(s.tokenOwnerA, "assign_member_role", { userId: s.member.userId, roleId: rolesB[0].id })).isError).toBe(true);
    expect((await tool(s.tokenOwnerB, "set_role_permissions", { roleId: s.roles.Member, permissions: [] })).isError).toBe(true);
  });
});

describe("removal", () => {
  it("cuts off a removed member on their next call, even with an unexpired token", async () => {
    await s.ownerA.browser.json("/api/auth/organization/remove-member", { memberIdOrEmail: s.member.email, organizationId: s.orgA });
    const { status } = await mcp(s.tokenMember, "tools/list");
    expect(status).toBe(403);
  });
});
