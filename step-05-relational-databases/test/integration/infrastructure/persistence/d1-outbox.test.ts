import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { D1OutboxStore } from "../../../../src/infrastructure/persistence/d1/d1-outbox-store";
import { createAccount } from "../../helpers/oauth";

// The outbox triggers (migrations/0004_outbox.sql) and D1OutboxStore, on a
// real D1. Other test files write to the same database, so each test looks
// only at its own rows (by aggregate ID) and uses its own consumer names.

async function eventsFor(aggregateId: string) {
  const rows = await env.AUTH_DB.prepare('SELECT "event_type", "payload" FROM "outbox" WHERE "aggregate_id" = ? ORDER BY "seq"')
    .bind(aggregateId)
    .all<{ event_type: string; payload: string }>();
  return rows.results.map((r) => ({ type: r.event_type, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

describe("outbox triggers", () => {
  it("records a sign-up: the user, their organization and their membership", async () => {
    const account = await createAccount("Outboxed");
    const user = await eventsFor(account.userId);
    expect(user.map((e) => e.type)).toEqual(["user.created", "user.updated"]); // updated = email confirmed
    expect(user[1].payload).toMatchObject({ id: account.userId, email: account.email, emailVerified: 1 });
    expect((await eventsFor(account.organizationId)).map((e) => e.type)).toContain("organization.created");

    const member = await env.AUTH_DB.prepare('SELECT "id" FROM "member" WHERE "userId" = ?').bind(account.userId).first<{ id: string }>();
    expect(await eventsFor(member!.id)).toEqual([
      { type: "member.added", payload: { id: member!.id, organizationId: account.organizationId, userId: account.userId, role: "owner" } },
    ]);
  });

  it("never puts a password, session or token in the outbox", async () => {
    await createAccount("Private");
    const rows = await env.AUTH_DB.prepare('SELECT "aggregate_type" AS t, "payload" FROM "outbox"').all<{ t: string; payload: string }>();
    const types = new Set(rows.results.map((r) => r.t));
    for (const t of ["account", "session", "verification", "jwks"]) expect(types).not.toContain(t);
    // Check the field names, not the values (a name could contain "token").
    const keys = new Set(rows.results.flatMap((r) => Object.keys(JSON.parse(r.payload) as object)));
    for (const k of keys) expect(k).not.toMatch(/password|token|secret|hash/i);
  });

  it("writes no event when the change fails (same transaction)", async () => {
    const before = await env.AUTH_DB.prepare('SELECT max("seq") AS s FROM "outbox"').first<{ s: number }>();
    const id = `atomic-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    // The second insert breaks a foreign key, so the batch rolls back, triggers included.
    await expect(
      env.AUTH_DB.batch([
        env.AUTH_DB.prepare('INSERT INTO "tenant" ("id", "name", "createdAt") VALUES (?, ?, ?)').bind(id, "Atomic", now),
        env.AUTH_DB.prepare('INSERT INTO "tenant_admin" ("tenantId", "userId", "level") VALUES (?, ?, ?)').bind(id, "no-such-user", "owner"),
      ]),
    ).rejects.toThrow();
    expect(await eventsFor(id)).toEqual([]);
    const after = await env.AUTH_DB.prepare('SELECT max("seq") AS s FROM "outbox" WHERE "aggregate_id" = ?').bind(id).first<{ s: number | null }>();
    expect(after?.s ?? null).toBeNull();
    expect(before).not.toBeNull();
  });

  it("has the invitation-email consumer registered by the migration", async () => {
    const row = await env.AUTH_DB.prepare('SELECT "name" FROM "outbox_consumer" WHERE "name" = ?').bind("invitation-email").first();
    expect(row).not.toBeNull();
  });
});

describe("D1OutboxStore", () => {
  const store = new D1OutboxStore(env.AUTH_DB);
  const now = "2026-11-27T00:00:00.000Z";

  it("registers a 'now' consumer at the end of the log and a 'beginning' one at 0, once", async () => {
    await createAccount("Logged"); // make sure the log isn't empty
    const max = (await env.AUTH_DB.prepare('SELECT max("seq") AS s FROM "outbox"').first<{ s: number }>())!.s;
    const fresh = await store.consumer(`fresh-${crypto.randomUUID()}`, "now", now);
    expect(fresh.lastSeq).toBeGreaterThanOrEqual(max);
    const history = await store.consumer(`history-${crypto.randomUUID()}`, "beginning", now);
    expect(history).toMatchObject({ lastSeq: 0, attempts: 0, lastError: null, failedAt: null });

    // Registering again leaves the position alone.
    await store.advance(history.name, 0, 5, now);
    expect((await store.consumer(history.name, "now", now)).lastSeq).toBe(5);
  });

  it("returns events after a position, oldest first, with parsed payloads", async () => {
    const events = await store.eventsAfter(0, 3);
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(typeof events[0].payload).toBe("object");
  });

  it("only advances from the position it was read at", async () => {
    const name = `cas-${crypto.randomUUID()}`;
    await store.consumer(name, "beginning", now);
    expect(await store.advance(name, 0, 3, now)).toBe(true);
    expect(await store.advance(name, 0, 4, now)).toBe(false); // stale: someone else moved it
    expect((await store.consumer(name, "beginning", now)).lastSeq).toBe(3);
  });

  it("records failures and clears them on the next advance", async () => {
    const name = `fail-${crypto.randomUUID()}`;
    await store.consumer(name, "beginning", now);
    await store.recordFailure(name, 2, "x".repeat(600), null, now);
    const failed = await store.consumer(name, "beginning", now);
    expect(failed).toMatchObject({ attempts: 2, failedAt: null });
    expect(failed.lastError).toHaveLength(500);
    await store.advance(name, 0, 1, now);
    expect(await store.consumer(name, "beginning", now)).toMatchObject({ attempts: 0, lastError: null });
  });
});
