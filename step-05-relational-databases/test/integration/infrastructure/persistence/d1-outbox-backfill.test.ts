import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// migrations/0006_outbox_backfill.sql, on a D1 of its own (SCRATCH_DB in
// vitest.config.ts): it has to start from data with an empty outbox, which
// the shared test database never has.

const bindings = env as unknown as { SCRATCH_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
const db = bindings.SCRATCH_DB;
const before = bindings.TEST_MIGRATIONS.filter((m) => m.name < "0006");
const backfill = bindings.TEST_MIGRATIONS.find((m) => m.name.startsWith("0006_outbox_backfill"))!;
const now = "2026-11-28T00:00:00.000Z";

async function runBackfill(): Promise<void> {
  await db.batch(backfill.queries.map((q) => db.prepare(q)));
}

async function eventTypes(): Promise<string[]> {
  const rows = await db.prepare('SELECT "event_type" FROM "outbox" ORDER BY "seq"').all<{ event_type: string }>();
  return rows.results.map((r) => r.event_type);
}

describe("outbox backfill (D1 migration 0006)", () => {
  it("writes one snapshot per row when there is data but the outbox is empty, and nothing when it isn't", async () => {
    await applyD1Migrations(db, before);
    // Data made before the outbox existed, simulated: write rows, then empty the outbox.
    await db.batch([
      db.prepare(`INSERT INTO "tenant" ("id", "name", "createdAt") VALUES ('t1', 'Acme', ?)`).bind(now),
      db.prepare(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES ('u1', 'Ana', 'ana@example.com', 1, ?, ?)`).bind(now, now),
      db.prepare(`INSERT INTO "tenant_admin" ("tenantId", "userId", "level") VALUES ('t1', 'u1', 'owner')`),
      db.prepare(`INSERT INTO "organization" ("id", "name", "slug", "createdAt", "tenantId") VALUES ('o1', 'Acme', 'acme', ?, 't1')`).bind(now),
      db.prepare(`INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt") VALUES ('m1', 'o1', 'u1', 'owner', ?)`).bind(now),
      db.prepare(`INSERT INTO "invitation" ("id", "organizationId", "email", "role", "status", "expiresAt", "createdAt", "inviterId") VALUES ('i1', 'o1', 'bo@example.com', 'member', 'pending', ?, ?, 'u1')`).bind(now, now),
      db.prepare(`INSERT INTO "org_role" ("id", "organizationId", "name", "builtin", "createdAt") VALUES ('r1', 'o1', 'Owner', 'owner', ?)`).bind(now),
      db.prepare(`INSERT INTO "org_role_permission" ("roleId", "permission") VALUES ('r1', 'sales:read')`),
      db.prepare(`INSERT INTO "org_member_role" ("organizationId", "userId", "roleId") VALUES ('o1', 'u1', 'r1')`),
      db.prepare(`DELETE FROM "outbox"`),
    ]);

    await runBackfill();
    expect(await eventTypes()).toEqual([
      "tenant.snapshot",
      "user.snapshot",
      "tenant_admin.snapshot",
      "organization.snapshot",
      "member.snapshot",
      "invitation.snapshot",
      "role.snapshot",
      "org_role_permission.snapshot",
      "org_member_role.snapshot",
    ]);
    const user = await db.prepare(`SELECT "payload" FROM "outbox" WHERE "event_type" = 'user.snapshot'`).first<{ payload: string }>();
    expect(JSON.parse(user!.payload)).toEqual({ id: "u1", name: "Ana", email: "ana@example.com", emailVerified: 1 });
    // No invitation email: that consumer only reacts to invitation.created.
    expect(await eventTypes()).not.toContain("invitation.created");

    // Run again: the outbox has rows now, so nothing more is written, and the scratch table is gone.
    await runBackfill();
    expect(await eventTypes()).toHaveLength(9);
    expect(await db.prepare(`SELECT name FROM sqlite_master WHERE name = 'outbox_backfill'`).first()).toBeNull();
  });
});
