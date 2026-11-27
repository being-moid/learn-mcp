import type { Role } from "../../../domain/entities/role";
import type { Permission } from "../../../domain/permissions";
import type { RoleRepository } from "../../../domain/ports/persistence/role-repository";
import { betterAuthRoleFor, EFFECTIVE_ROLE_SQL, loadPermissions } from "./role-sql";

type RoleRow = Omit<Role, "permissions">;

// RoleRepository on D1, for ONE organization: every query is filtered by the
// organizationId this instance was built with, so it can't read or change
// another organization's roles. A role and its permissions are one aggregate:
// they are always written together, in one db.batch() (a transaction).
export class D1RoleRepository implements RoleRepository {
  constructor(
    private readonly db: D1Database,
    private readonly organizationId: string,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  private async withPermissions(row: RoleRow | null): Promise<Role | null> {
    return row ? { ...row, permissions: await loadPermissions(this.db, row.id) } : null;
  }

  async list(): Promise<Role[]> {
    const rows = await this.db
      // Built-in roles first, from most to least powerful, then the
      // organization's own roles in the order they were created.
      .prepare(
        `SELECT "id", "organizationId", "name", "builtin" FROM "org_role" WHERE "organizationId" = ?
          ORDER BY CASE "builtin" WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, "createdAt", "name"`,
      )
      .bind(this.organizationId)
      .all<RoleRow>();
    return Promise.all(rows.results.map(async (r) => (await this.withPermissions(r))!));
  }

  async get(roleId: string): Promise<Role | null> {
    const row = await this.db
      .prepare(`SELECT "id", "organizationId", "name", "builtin" FROM "org_role" WHERE "organizationId" = ? AND "id" = ?`)
      .bind(this.organizationId, roleId)
      .first<RoleRow>();
    return this.withPermissions(row);
  }

  async findByName(name: string): Promise<Role | null> {
    const row = await this.db
      .prepare(`SELECT "id", "organizationId", "name", "builtin" FROM "org_role" WHERE "organizationId" = ? AND "name" = ?`)
      .bind(this.organizationId, name)
      .first<RoleRow>();
    return this.withPermissions(row);
  }

  async seedDefaults(roles: ReadonlyArray<{ builtin: "owner" | "admin" | "member"; name: string; permissions: readonly Permission[] }>): Promise<void> {
    const existing = await this.db
      .prepare(`SELECT count(*) AS n FROM "org_role" WHERE "organizationId" = ? AND "builtin" IS NOT NULL`)
      .bind(this.organizationId)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) return; // already seeded
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const role of roles) {
      const id = this.newId();
      statements.push(this.insertRole(id, role.name, role.builtin, now), ...this.insertPermissions(id, role.permissions));
    }
    await this.db.batch(statements);
  }

  async create({ name, permissions }: { name: string; permissions: readonly Permission[] }): Promise<Role> {
    const id = this.newId();
    await this.db.batch([this.insertRole(id, name, null, new Date().toISOString()), ...this.insertPermissions(id, permissions)]);
    return { id, organizationId: this.organizationId, name, builtin: null, permissions: [...permissions] };
  }

  async setPermissions(roleId: string, permissions: readonly Permission[]): Promise<void> {
    await this.db.batch([
      // The role must belong to this organization, or nothing is deleted or added.
      this.db
        .prepare(`DELETE FROM "org_role_permission" WHERE "roleId" = (SELECT "id" FROM "org_role" WHERE "id" = ? AND "organizationId" = ?)`)
        .bind(roleId, this.organizationId),
      ...permissions.map((p) =>
        this.db
          .prepare(`INSERT INTO "org_role_permission" ("roleId", "permission") SELECT "id", ? FROM "org_role" WHERE "id" = ? AND "organizationId" = ?`)
          .bind(p, roleId, this.organizationId),
      ),
    ]);
  }

  async roleOf(userId: string): Promise<Role | null> {
    const row = await this.db.prepare(EFFECTIVE_ROLE_SQL).bind(this.organizationId, userId).first<RoleRow>();
    return this.withPermissions(row);
  }

  async assign(userId: string, role: Role): Promise<void> {
    if (role.organizationId !== this.organizationId) throw new Error("Role belongs to another organization");
    await this.db.batch([
      this.db
        .prepare(`INSERT OR REPLACE INTO "org_member_role" ("organizationId", "userId", "roleId") VALUES (?, ?, ?)`)
        .bind(this.organizationId, userId, role.id),
      // Keep Better Auth's own coarse role in step, so its permission checks
      // (on its organization endpoints) agree with ours.
      this.db
        .prepare(`UPDATE "member" SET "role" = ? WHERE "organizationId" = ? AND "userId" = ?`)
        .bind(betterAuthRoleFor(role), this.organizationId, userId),
    ]);
  }

  async countOwners(): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT count(*) AS n
           FROM "member" m
           LEFT JOIN "org_member_role" a ON a."organizationId" = m."organizationId" AND a."userId" = m."userId"
           JOIN "org_role" r ON r."organizationId" = m."organizationId"
                            AND (r."id" = a."roleId" OR (a."roleId" IS NULL AND r."builtin" = m."role"))
          WHERE m."organizationId" = ? AND r."builtin" = 'owner'`,
      )
      .bind(this.organizationId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  private insertRole(id: string, name: string, builtin: Role["builtin"], now: string): D1PreparedStatement {
    return this.db
      .prepare(`INSERT INTO "org_role" ("id", "organizationId", "name", "builtin", "createdAt") VALUES (?, ?, ?, ?, ?)`)
      .bind(id, this.organizationId, name, builtin, now);
  }

  private insertPermissions(roleId: string, permissions: readonly Permission[]): D1PreparedStatement[] {
    return permissions.map((p) =>
      this.db.prepare(`INSERT INTO "org_role_permission" ("roleId", "permission") VALUES (?, ?)`).bind(roleId, p),
    );
  }
}
