import type { TenantRepository } from "../../src/domain/ports/persistence/tenant-repository";

/** An in-memory TenantRepository for unit tests: records what was created. */
export class InMemoryTenantRepository implements TenantRepository {
  readonly tenants: Array<{ tenantId: string; tenantName: string; ownerUserId: string; organizationId: string }> = [];

  async tenantOwnedBy(userId: string): Promise<string | null> {
    return this.tenants.find((t) => t.ownerUserId === userId)?.tenantId ?? null;
  }

  async createTenantForOrganization(input: Parameters<TenantRepository["createTenantForOrganization"]>[0]): Promise<void> {
    this.tenants.push({ tenantId: input.tenantId, tenantName: input.tenantName, ownerUserId: input.ownerUserId, organizationId: input.organizationId });
  }
}
