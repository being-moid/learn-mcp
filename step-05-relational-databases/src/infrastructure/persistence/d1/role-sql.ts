import type { Role } from "../../../domain/entities/role";
import { isPermission } from "../../../domain/permissions";

// SQL shared by the D1 repositories that need a member's effective role.
//
// A member's role is the one assigned to them in "org_member_role"; with no
// assignment, it is the organization's built-in role matching Better Auth's
// "member"."role" (owner, admin or member). Bind (organizationId, userId).
export const EFFECTIVE_ROLE_SQL = `
  SELECT r."id" AS id, r."organizationId" AS organizationId, r."name" AS name, r."builtin" AS builtin
    FROM "member" m
    LEFT JOIN "org_member_role" a ON a."organizationId" = m."organizationId" AND a."userId" = m."userId"
    JOIN "org_role" r ON r."organizationId" = m."organizationId"
                     AND (r."id" = a."roleId" OR (a."roleId" IS NULL AND r."builtin" = m."role"))
   WHERE m."organizationId" = ? AND m."userId" = ?`;

/** Reads a role's permissions; ignores any stored value that isn't in today's fixed list. */
export async function loadPermissions(db: D1Database, roleId: string): Promise<Role["permissions"]> {
  const rows = await db
    .prepare(`SELECT "permission" FROM "org_role_permission" WHERE "roleId" = ? ORDER BY "permission"`)
    .bind(roleId)
    .all<{ permission: string }>();
  return rows.results.map((r) => r.permission).filter(isPermission);
}

/** The coarse role Better Auth keeps in "member"."role", derived from one of our roles. */
export function betterAuthRoleFor(role: Pick<Role, "builtin" | "permissions">): "owner" | "admin" | "member" {
  if (role.builtin) return role.builtin;
  return role.permissions.includes("roles:manage") ? "admin" : "member";
}
