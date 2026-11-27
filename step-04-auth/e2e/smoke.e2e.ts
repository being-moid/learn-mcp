import { beforeAll, describe, expect, it } from "vitest";
import { accessToken, organizationsOf, registerClient, signUp, textOf, tool, type User } from "./lib/client.ts";
import { baseUrl } from "./lib/config.ts";

// A short check of production after a deploy: the real Worker, D1, Secrets
// Store and Resend (to Resend's test inbox). One tagged test company with an
// Owner and a Member, deleted afterwards by e2e/cleanup.ts whatever happens.
// It uses only what any user can do: no production secrets in the test.

const s: { client: string; owner: User; tokenOwner: string; org: string; member: User; tokenMember: string } = {} as never;

beforeAll(async () => {
  s.client = await registerClient();
  s.owner = await signUp("owner");
  [s.org] = (await organizationsOf(s.owner)).map((o) => o.id);
  s.tokenOwner = await accessToken(s.owner, s.client);
});

describe("production", () => {
  it("publishes its sign-in discovery documents", async () => {
    const resource = (await (await fetch(`${baseUrl()}/.well-known/oauth-protected-resource/mcp`)).json()) as any;
    expect(resource.resource).toBe(`${baseUrl()}/mcp`);
    const server = (await (await fetch(`${baseUrl()}/.well-known/oauth-authorization-server/api/auth`)).json()) as any;
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.client_id_metadata_document_supported).toBe(true);
  });

  it("serves the sign-in pages", async () => {
    for (const path of ["/sign-in", "/consent", "/select-organization", "/accept-invitation"]) {
      expect((await fetch(`${baseUrl()}${path}`)).status, path).toBe(200);
    }
  });

  it("signs up an Owner with their own company and the default roles", async () => {
    const roles = (await tool(s.tokenOwner, "list_roles")).structuredContent.roles.map((r: { name: string }) => r.name);
    expect(roles).toEqual(["Owner", "Admin", "Member"]);
  });

  it("saves, lists and deletes a note", async () => {
    const created = await tool(s.tokenOwner, "create_note", { title: "Smoke", body: "Deploy check" });
    expect(created.isError).toBeFalsy();
    const id = created.structuredContent.id;
    expect((await tool(s.tokenOwner, "list_notes")).structuredContent.notes.map((n: { id: string }) => n.id)).toContain(id);
    expect((await tool(s.tokenOwner, "delete_note", { id })).structuredContent.deleted).toBe(true);
  });

  it("invites a Member (a real email, to Resend's test inbox) who then has Member rights only", async () => {
    s.member = await signUp("member");
    const invited = await tool(s.tokenOwner, "invite_member", { email: s.member.email });
    expect(invited.isError).toBeFalsy();
    await s.member.browser.json("/api/auth/organization/accept-invitation", { invitationId: invited.structuredContent.invitationId });
    s.tokenMember = await accessToken(s.member, s.client, s.org);

    expect((await tool(s.tokenMember, "create_note", { title: "Member", body: "x" })).isError).toBeFalsy();
    const refused = await tool(s.tokenMember, "list_company_members");
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/members:read/);
  });
});
