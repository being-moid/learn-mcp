import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool, rpc } from "../helpers/mcp";
import { addMember, createAccount, issueAccessToken, registerClient } from "../helpers/oauth";

// Roles and permissions through the real server: real accounts, real tokens,
// the tools a client would call.

async function organizationWithMember() {
  const client = await registerClient();
  const owner = await createAccount("Owner");
  const ownerToken = await issueAccessToken(owner, client);
  const member = await addMember(owner, "Member");
  const memberToken = await issueAccessToken(member, client, owner.organizationId);
  return { owner, ownerToken, member, memberToken };
}

const text = (result: { content: Array<{ text: string }> }) => result.content[0].text;

describe("roles and permissions", () => {
  it("shows an Owner the members and the three default roles", async () => {
    const { ownerToken, member } = await organizationWithMember();
    const members = await callTool("list_company_members", {}, ownerToken);
    expect(members.structuredContent.members.map((m: { email: string; role: { name: string } }) => [m.email, m.role.name])).toContainEqual([member.email, "Member"]);
    const roles = await callTool("list_roles", {}, ownerToken);
    expect(roles.structuredContent.roles.map((r: { name: string }) => r.name)).toEqual(["Owner", "Admin", "Member"]);
  });

  it("refuses a Member the admin tools, with a clear reason", async () => {
    const { memberToken } = await organizationWithMember();
    const result = await callTool("list_company_members", {}, memberToken);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('"members:read" permission');
  });

  it("applies a role change on the member's very next call, with the same token", async () => {
    const { ownerToken, member, memberToken } = await organizationWithMember();
    expect((await callTool("database_status", {}, memberToken)).isError).toBeFalsy();

    const directory = await callTool("create_role", { name: "Directory only", permissions: ["members:read"] }, ownerToken);
    const assigned = await callTool("assign_member_role", { userId: member.userId, roleId: directory.structuredContent.id }, ownerToken);
    expect(assigned.isError).toBeFalsy();

    expect((await callTool("list_company_members", {}, memberToken)).isError).toBeFalsy();
    const refused = await callTool("database_status", {}, memberToken);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('"sales:read" permission');
  });

  it("won't let the last Owner demote themselves", async () => {
    const { owner, ownerToken } = await organizationWithMember();
    const roles = await callTool("list_roles", {}, ownerToken);
    const admin = roles.structuredContent.roles.find((r: { builtin: string }) => r.builtin === "admin");
    const result = await callTool("assign_member_role", { userId: owner.userId, roleId: admin.id }, ownerToken);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("at least one Owner");
  });

  it("can't reach another organization's roles or members", async () => {
    const a = await organizationWithMember();
    const b = await organizationWithMember();
    const bRoles = await callTool("list_roles", {}, b.ownerToken);
    const bMember = bRoles.structuredContent.roles.find((r: { builtin: string }) => r.builtin === "member");

    const changeTheirs = await callTool("set_role_permissions", { roleId: bMember.id, permissions: [] }, a.ownerToken);
    expect(changeTheirs.isError).toBe(true);
    expect(text(changeTheirs)).toContain("No role with that ID");
    const assignTheirs = await callTool("assign_member_role", { userId: b.member.userId, roleId: bMember.id }, a.ownerToken);
    expect(assignTheirs.isError).toBe(true);

    // And B's Member role still has its permissions.
    const after = await callTool("list_roles", {}, b.ownerToken);
    expect(after.structuredContent.roles.find((r: { id: string }) => r.id === bMember.id).permissions).toEqual(["sales:read"]);
  });

});
