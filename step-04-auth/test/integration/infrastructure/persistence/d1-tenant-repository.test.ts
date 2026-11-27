import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1TenantRepository } from "../../../../src/infrastructure/persistence/d1/d1-tenant-repository";
import { createAccount } from "../../helpers/oauth";

it("sets up a tenant all-or-nothing: a failure leaves no partial tenant", async () => {
  const account = await createAccount("Atomic");
  const repo = new D1TenantRepository(env.AUTH_DB);
  // The tenant row is fine, but the owner doesn't exist, so the second
  // statement breaks a foreign key and the batch fails part-way through.
  await expect(
    repo.createTenantForOrganization({
      tenantId: "atomic-tenant",
      tenantName: "Atomic",
      ownerUserId: "no-such-user",
      organizationId: account.organizationId,
      now: new Date().toISOString(),
    }),
  ).rejects.toThrow();
  expect(await env.AUTH_DB.prepare('SELECT 1 FROM "tenant" WHERE "id" = ?').bind("atomic-tenant").first()).toBeNull();
  expect(await env.AUTH_DB.prepare('SELECT 1 FROM "tenant_admin" WHERE "tenantId" = ?').bind("atomic-tenant").first()).toBeNull();
});
