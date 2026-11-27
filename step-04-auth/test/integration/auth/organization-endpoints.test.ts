import { describe, expect, it } from "vitest";
import { callTool, rpc } from "../helpers/mcp";
import { addMember, browserPost, createAccount, issueAccessToken, registerClient } from "../helpers/oauth";

// Better Auth's own organization endpoints would let a signed-in browser
// change members and roles without our guardrails (an Admin could make
// someone an Owner there). Only the five our pages need stay open; members
// and roles change only through the MCP tools.

describe("Better Auth organization endpoints", () => {
  it("refuses every endpoint that changes or reveals members, roles or organizations", async () => {
    const owner = await createAccount("Locked");
    const member = await addMember(owner, "Target");
    const organizationId = owner.organizationId;
    for (const [path, body] of [
      ["update-member-role", { memberId: member.userId, role: "owner", organizationId }],
      ["remove-member", { memberIdOrEmail: member.email, organizationId }],
      ["invite-member", { email: "someone@example.com", role: "admin", organizationId }],
      ["add-member", { userId: member.userId, role: "owner", organizationId }],
      ["create", { name: "Side company", slug: `side-${crypto.randomUUID()}` }],
      ["update", { data: { name: "Renamed" }, organizationId }],
      ["delete", { organizationId }],
      ["leave", { organizationId }],
      ["cancel-invitation", { invitationId: "x" }],
      ["get-full-organization", {}],
      ["list-members", {}],
    ] as const) {
      const res = await browserPost(member, `/api/auth/organization/${path}`, body);
      expect(res.status, path).toBe(403);
    }
  });

  it("keeps the ones the pages need", async () => {
    const owner = await createAccount("Picker");
    expect((await browserPost(owner, "/api/auth/organization/set-active", { organizationId: owner.organizationId })).status).toBe(200);
  });
});

describe("remove_member", () => {
  async function setup() {
    const client = await registerClient();
    const owner = await createAccount("Remover");
    const ownerToken = await issueAccessToken(owner, client);
    const member = await addMember(owner, "Leaver");
    const memberToken = await issueAccessToken(member, client, owner.organizationId);
    return { owner, ownerToken, member, memberToken };
  }

  it("removes a member, who loses access on their next call", async () => {
    const { ownerToken, member, memberToken } = await setup();
    expect((await callTool("list_notes", {}, memberToken)).isError).toBeFalsy();
    const result = await callTool("remove_member", { userId: member.userId }, ownerToken);
    expect(result.structuredContent).toEqual({ userId: member.userId, removed: true });
    await expect(rpc("tools/list", {}, undefined, memberToken)).rejects.toThrow(/403/);
  });

  it("refuses a Member, removing yourself, and the last Owner", async () => {
    const { owner, ownerToken, member, memberToken } = await setup();
    const asMember = await callTool("remove_member", { userId: owner.userId }, memberToken);
    expect(asMember.isError).toBe(true);
    expect(asMember.content[0].text).toContain('"members:remove" permission');
    const self = await callTool("remove_member", { userId: owner.userId }, ownerToken);
    expect(self.isError).toBe(true);
    expect(self.content[0].text).toMatch(/can't remove yourself/);
    expect((await callTool("remove_member", { userId: "not-a-member" }, ownerToken)).isError).toBe(true);
    expect((await callTool("list_notes", {}, memberToken)).isError).toBeFalsy(); // still a member
    void member;
  });
});
