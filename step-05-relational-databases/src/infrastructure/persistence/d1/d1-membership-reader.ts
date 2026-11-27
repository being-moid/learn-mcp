import type { MemberRole, MemberSummary, Membership } from "../../../domain/entities/membership";
import type { MembershipReader } from "../../../domain/ports/persistence/membership-reader";
import { EFFECTIVE_ROLE_SQL, loadPermissions } from "./role-sql";

// MembershipReader on D1. It reads Better Auth's tables ("member",
// "organization", "user") and ours (roles), and never writes.
export class D1MembershipReader implements MembershipReader {
  constructor(private readonly db: D1Database) {}

  async find(userId: string, organizationId: string): Promise<Membership | null> {
    const member = await this.db
      .prepare(
        `SELECT o."tenantId" AS tenantId FROM "member" m JOIN "organization" o ON o."id" = m."organizationId"
          WHERE m."userId" = ? AND m."organizationId" = ?`,
      )
      .bind(userId, organizationId)
      .first<{ tenantId: string | null }>();
    if (!member) return null;

    // A member whose role can't be found (an organization without roles) gets
    // no permissions: they can sign in but do nothing. Fail closed.
    const role = await this.db.prepare(EFFECTIVE_ROLE_SQL).bind(organizationId, userId).first<MemberRole>();
    return {
      userId,
      organizationId,
      tenantId: member.tenantId,
      role: role ? { id: role.id, name: role.name, builtin: role.builtin } : { id: "", name: "No role", builtin: null },
      permissions: role ? await loadPermissions(this.db, role.id) : [],
    };
  }

  async organizationsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .prepare(`SELECT "organizationId" FROM "member" WHERE "userId" = ? ORDER BY "createdAt", "id"`)
      .bind(userId)
      .all<{ organizationId: string }>();
    return rows.results.map((r) => r.organizationId);
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    const rows = await this.db
      .prepare(
        `SELECT u."id" AS userId, u."name" AS name, u."email" AS email,
                r."id" AS roleId, r."name" AS roleName, r."builtin" AS builtin
           FROM "member" m
           JOIN "user" u ON u."id" = m."userId"
           LEFT JOIN "org_member_role" a ON a."organizationId" = m."organizationId" AND a."userId" = m."userId"
           LEFT JOIN "org_role" r ON r."organizationId" = m."organizationId"
                                 AND (r."id" = a."roleId" OR (a."roleId" IS NULL AND r."builtin" = m."role"))
          WHERE m."organizationId" = ?
          ORDER BY u."name"`,
      )
      .bind(organizationId)
      .all<{ userId: string; name: string; email: string; roleId: string | null; roleName: string | null; builtin: MemberRole["builtin"] }>();
    return rows.results.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: { id: r.roleId ?? "", name: r.roleName ?? "No role", builtin: r.builtin },
    }));
  }

  async organizationName(organizationId: string): Promise<string | null> {
    const row = await this.db.prepare(`SELECT "name" FROM "organization" WHERE "id" = ?`).bind(organizationId).first<{ name: string }>();
    return row?.name ?? null;
  }
}
