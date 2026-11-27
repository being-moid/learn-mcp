import { z } from "zod";
import { PERMISSIONS } from "../../../domain/permissions";
import { defineTool, type Tool } from "../tool-kit";

// Admin tools: members and roles of the caller's organization. Which
// organization is never an argument: it is the one in the caller's token.
// A user ID argument names a member *inside* that organization (from
// list_company_members); anyone else is "not a member".
//
// The rules (who may grant what, keeping an Owner, ...) live in RolesService;
// these tools only translate between the model and the service.

const permission = z.enum(PERMISSIONS);
const permissionList = z
  .array(permission)
  .max(PERMISSIONS.length)
  .describe(`Permissions the role grants. Any of: ${PERMISSIONS.join(", ")}. You can only grant permissions you have yourself.`);

const roleOutput = z.object({ id: z.string(), name: z.string(), builtin: z.string().nullable(), permissions: z.array(z.string()) });
const roleId = z.string().min(1).max(64).describe("The role's ID, from list_roles.");
const userId = z.string().min(1).max(64).describe("The member's user ID, from list_company_members.");

const describeRole = (r: { name: string; permissions: readonly string[] }) =>
  `${r.name}: ${r.permissions.length ? r.permissions.join(", ") : "no permissions"}`;

const listCompanyMembersTool = defineTool({
  name: "list_company_members",
  requires: "members:read",
  title: "List the organization's members",
  description:
    "List everyone in your organization with their email and role. Use it to find a member's user ID before assigning them a role. Only shows your own organization.",
  input: z.object({}),
  output: z.object({
    members: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string(), role: z.object({ id: z.string(), name: z.string() }) })),
  }),
  hints: { readOnly: true, destructive: false, idempotent: true },
  run: async (_args, _ctx, { members }) => {
    const list = await members.list();
    const text = list.map((m) => `- ${m.name} <${m.email}>: ${m.role.name} (user ${m.userId})`).join("\n");
    return {
      content: [{ type: "text", text: `${list.length} member(s):\n${text}` }],
      structuredContent: { members: list.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: { id: m.role.id, name: m.role.name } })) },
    };
  },
});

const listRolesTool = defineTool({
  name: "list_roles",
  requires: "members:read",
  title: "List the organization's roles",
  description:
    "List the roles your organization defines, with each role's ID and the permissions it grants. Built-in roles (Owner, Admin, Member) are marked; other roles were created by your organization.",
  input: z.object({}),
  output: z.object({ roles: z.array(roleOutput) }),
  hints: { readOnly: true, destructive: false, idempotent: true },
  run: async (_args, _ctx, { roles }) => {
    const list = await roles.list();
    const text = list.map((r) => `- ${describeRole(r)}${r.builtin ? " [built-in]" : ""} (id ${r.id})`).join("\n");
    return {
      content: [{ type: "text", text: `${list.length} role(s):\n${text}` }],
      structuredContent: { roles: list.map((r) => ({ id: r.id, name: r.name, builtin: r.builtin, permissions: [...r.permissions] })) },
    };
  },
});

const createRoleTool = defineTool({
  name: "create_role",
  requires: "roles:manage",
  title: "Create a role",
  description:
    "Create a new role in your organization with a name of your choice and the permissions it grants, e.g. a \"Sales rep\" role with notes:read and notes:write. Doesn't assign it to anyone; use assign_member_role for that.",
  input: z.object({
    name: z.string().trim().min(1).max(50).describe("The role's name, unique in your organization, e.g. \"Regional manager\"."),
    permissions: permissionList,
  }),
  output: roleOutput,
  hints: { readOnly: false, destructive: false, idempotent: false },
  run: async ({ name, permissions }, _ctx, { roles }) => {
    const role = await roles.create(name, permissions);
    return {
      content: [{ type: "text", text: `Created role ${describeRole(role)} (id ${role.id}).` }],
      structuredContent: { id: role.id, name: role.name, builtin: role.builtin, permissions: [...role.permissions] },
    };
  },
});

const setRolePermissionsTool = defineTool({
  name: "set_role_permissions",
  requires: "roles:manage",
  title: "Change what a role allows",
  description:
    "Replace the permissions of one of your organization's roles. This changes access for everyone who has the role. The Owner role can't be changed.",
  input: z.object({ roleId, permissions: permissionList }),
  output: roleOutput,
  // Destructive: it can take access away from everyone with the role.
  hints: { readOnly: false, destructive: true, idempotent: true },
  run: async ({ roleId, permissions }, _ctx, { roles }) => {
    const role = await roles.setPermissions(roleId, permissions);
    return {
      content: [{ type: "text", text: `Updated role ${describeRole(role)}.` }],
      structuredContent: { id: role.id, name: role.name, builtin: role.builtin, permissions: [...role.permissions] },
    };
  },
});

const assignMemberRoleTool = defineTool({
  name: "assign_member_role",
  requires: "roles:manage",
  title: "Give a member a role",
  description:
    "Give a member of your organization one of its roles, replacing their current role. Get the user ID from list_company_members and the role ID from list_roles. Your organization always keeps at least one Owner, and only an Owner can make someone an Owner.",
  input: z.object({ userId, roleId }),
  output: z.object({ userId: z.string(), role: roleOutput }),
  // Destructive: it changes what someone can do, possibly removing access.
  hints: { readOnly: false, destructive: true, idempotent: true },
  run: async ({ userId, roleId }, _ctx, { roles }) => {
    const role = await roles.assign(userId, roleId);
    return {
      content: [{ type: "text", text: `Member ${userId} now has the role ${role.name}.` }],
      structuredContent: { userId, role: { id: role.id, name: role.name, builtin: role.builtin, permissions: [...role.permissions] } },
    };
  },
});

const removeMemberTool = defineTool({
  name: "remove_member",
  requires: "members:remove",
  title: "Remove someone from the organization",
  description:
    "Remove a member from your organization. They lose access on their next request, in every connected app. Get the user ID from list_company_members. You can't remove yourself, only an Owner can remove an Owner, and the organization always keeps at least one Owner. Their notes are kept but no longer reachable by them.",
  input: z.object({ userId }),
  output: z.object({ userId: z.string(), removed: z.boolean() }),
  // Destructive: it takes someone's access away.
  hints: { readOnly: false, destructive: true, idempotent: false },
  run: async ({ userId }, _ctx, { roles }) => {
    await roles.remove(userId);
    return {
      content: [{ type: "text", text: `Removed member ${userId}. Their access ends on their next request.` }],
      structuredContent: { userId, removed: true },
    };
  },
});

const inviteMemberTool = defineTool({
  name: "invite_member",
  requires: "members:invite",
  title: "Invite someone to the organization",
  description:
    "Invite a person to join your organization by email, as a Member (the default) or an Admin. They get an email with a link to accept; the invitation expires in 48 hours. If the address already has a pending invitation, that one is returned and no new email is sent. You can only invite someone as Admin if you hold every Admin permission yourself; nobody can be invited straight in as Owner.",
  input: z.object({
    email: z.string().trim().max(254).describe("The person's email address. They must sign in (or sign up) with this address to accept."),
    role: z.enum(["member", "admin"]).default("member").describe("The role they join with: member (default) or admin."),
  }),
  output: z.object({ invitationId: z.string(), email: z.string(), role: z.string(), expiresAt: z.string(), reused: z.boolean() }),
  // Idempotent: inviting the same address again returns the pending invitation.
  // Open world: it results in an email to someone outside the server.
  hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
  onFailure: "The invitation may not have been created: try again (a pending invitation is reused, not duplicated).",
  run: async ({ email, role }, _ctx, { members }) => {
    const { invitation, reused } = await members.invite(email, role);
    return {
      content: [
        {
          type: "text",
          text: reused
            ? `${invitation.email} already has a pending invitation (as ${invitation.role}); it expires at ${invitation.expiresAt}. No new email was sent.`
            : `Invited ${invitation.email} as ${invitation.role}. They'll get an email shortly; the invitation expires at ${invitation.expiresAt}.`,
        },
      ],
      structuredContent: { invitationId: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, reused },
    };
  },
});

/** The admin tools, as one group (see tools/index.ts for the full list). */
export const adminTools: Tool[] = [listCompanyMembersTool, listRolesTool, createRoleTool, setRolePermissionsTool, assignMemberRoleTool, inviteMemberTool, removeMemberTool];
