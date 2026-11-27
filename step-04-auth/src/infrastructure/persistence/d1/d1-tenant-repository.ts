import type { TenantRepository } from "../../../domain/ports/persistence/tenant-repository";

// TenantRepository on D1. Setting up a tenant touches three tables, so it is
// one db.batch(): D1 runs a batch as a transaction, and a failure anywhere
// rolls all of it back.
export class D1TenantRepository implements TenantRepository {
  constructor(private readonly db: D1Database) {}

  async tenantOwnedBy(userId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT "tenantId" FROM "tenant_admin" WHERE "userId" = ? AND "level" = 'owner' LIMIT 1`)
      .bind(userId)
      .first<{ tenantId: string }>();
    return row?.tenantId ?? null;
  }

  async createTenantForOrganization(input: {
    tenantId: string;
    tenantName: string;
    ownerUserId: string;
    organizationId: string;
    now: string;
  }): Promise<void> {
    const { tenantId, tenantName, ownerUserId, organizationId, now } = input;
    await this.db.batch([
      this.db.prepare(`INSERT INTO "tenant" ("id", "name", "createdAt") VALUES (?, ?, ?)`).bind(tenantId, tenantName, now),
      this.db.prepare(`INSERT INTO "tenant_admin" ("tenantId", "userId", "level") VALUES (?, ?, 'owner')`).bind(tenantId, ownerUserId),
      // Only claims an organization that no tenant owns yet.
      this.db.prepare(`UPDATE "organization" SET "tenantId" = ? WHERE "id" = ? AND "tenantId" IS NULL`).bind(tenantId, organizationId),
    ]);
  }
}
