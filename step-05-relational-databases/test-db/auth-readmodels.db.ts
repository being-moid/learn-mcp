import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@neondatabase/serverless";
import { connectToBranch } from "../db/lib/neon-branch.ts";
import { NeonReadModelConsumer, type TransactionFn } from "../src/infrastructure/readmodel/neon-readmodel-consumer";

// The read-model consumer's real SQL against a Neon branch: a sequence of
// outbox events like D1 records them, applied in order, then checked. IDs and
// event IDs carry this run's tag and are deleted at the end.

const tag = `test-rm-${Date.now().toString(36)}`;
const id = (name: string) => `${tag}-${name}`;
let seq = 0;
let client: Client;
let consumer: NeonReadModelConsumer;

const deliver = (eventType: string, payload: Record<string, unknown>, eventId = id(`evt-${++seq}`)) =>
  consumer.handle({ seq, id: eventId, eventType, payload, occurredAt: new Date().toISOString() });
const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0];

beforeAll(async () => {
  client = await connectToBranch(process.env.NEON_BRANCH ?? "dev");
  const transaction: TransactionFn = async (statements) => {
    await client.query("BEGIN");
    try {
      for (const s of statements) await client.query(s.text, s.params);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  };
  consumer = new NeonReadModelConsumer(transaction);
});

afterAll(async () => {
  if (!client) return;
  const like = `${tag}-%`;
  await client.query("DELETE FROM outbox_inbox WHERE event_id LIKE $1", [like]);
  for (const [table, column] of [
    ["user_readmodel", "id"], ["tenant_readmodel", "id"], ["tenant_admin_readmodel", "tenant_id"], ["organization_readmodel", "id"],
    ["member_readmodel", "id"], ["invitation_readmodel", "id"], ["org_role_readmodel", "id"], ["org_role_permission_readmodel", "role_id"],
    ["org_member_role_readmodel", "organization_id"],
  ]) await client.query(`DELETE FROM ${table} WHERE ${column} LIKE $1`, [like]);
  await client.end();
});

describe("auth read models on Neon", () => {
  it("builds the read models from a sign-up's events, then follows changes and deletes", async () => {
    await deliver("tenant.created", { id: id("t"), name: "Acme" });
    await deliver("user.created", { id: id("u"), name: "Ana", email: "ana@example.com", emailVerified: 0 });
    await deliver("user.updated", { id: id("u"), name: "Ana", email: "ana@example.com", emailVerified: 1 });
    await deliver("tenant.admin_added", { tenantId: id("t"), userId: id("u"), level: "owner" });
    await deliver("organization.created", { id: id("o"), name: "Acme", slug: "acme", tenantId: id("t") });
    await deliver("member.added", { id: id("m"), organizationId: id("o"), userId: id("u"), role: "owner" });
    await deliver("role.created", { id: id("r"), organizationId: id("o"), name: "Owner", builtin: "owner" });
    await deliver("role.permission_granted", { roleId: id("r"), permission: "sales:read" });
    await deliver("member.role_assigned", { organizationId: id("o"), userId: id("u"), roleId: id("r") });
    await deliver("invitation.created", { id: id("i"), organizationId: id("o"), email: "bo@example.com", role: "member", inviterId: id("u"), expiresAt: "2026-12-01" });
    await deliver("invitation.status_changed", { id: id("i"), organizationId: id("o"), email: "bo@example.com", status: "accepted" });

    expect(await one("SELECT name, email, email_verified FROM user_readmodel WHERE id = $1", [id("u")])).toEqual({ name: "Ana", email: "ana@example.com", email_verified: true });
    expect(await one("SELECT name, tenant_id FROM organization_readmodel WHERE id = $1", [id("o")])).toEqual({ name: "Acme", tenant_id: id("t") });
    expect(await one("SELECT status, role FROM invitation_readmodel WHERE id = $1", [id("i")])).toEqual({ status: "accepted", role: "member" });
    expect(await one("SELECT role_id FROM org_member_role_readmodel WHERE organization_id = $1 AND user_id = $2", [id("o"), id("u")])).toEqual({ role_id: id("r") });
    expect(await one("SELECT count(*)::int AS n FROM org_role_permission_readmodel WHERE role_id = $1", [id("r")])).toEqual({ n: 1 });

    await deliver("role.renamed", { id: id("r"), organizationId: id("o"), name: "Founder" });
    await deliver("member.removed", { id: id("m"), organizationId: id("o"), userId: id("u") });
    await deliver("role.deleted", { id: id("r"), organizationId: id("o") });
    expect(await one("SELECT count(*)::int AS n FROM member_readmodel WHERE id = $1", [id("m")])).toEqual({ n: 0 });
    expect(await one("SELECT count(*)::int AS n FROM org_role_readmodel WHERE id = $1", [id("r")])).toEqual({ n: 0 });
    expect(await one("SELECT count(*)::int AS n FROM org_role_permission_readmodel WHERE role_id = $1", [id("r")])).toEqual({ n: 0 });
  });

  it("applies a repeated event once: the second delivery changes nothing and doesn't fail", async () => {
    const eventId = id("evt-repeat");
    await deliver("user.created", { id: id("u2"), name: "First", email: "u2@example.com", emailVerified: 1 }, eventId);
    // The same event delivered again, but suppose its payload were different:
    // the inbox refuses it, so the row keeps the first delivery's values.
    await deliver("user.created", { id: id("u2"), name: "Second", email: "u2@example.com", emailVerified: 1 }, eventId);
    expect(await one("SELECT name FROM user_readmodel WHERE id = $1", [id("u2")])).toEqual({ name: "First" });
    expect(await one("SELECT count(*)::int AS n FROM outbox_inbox WHERE event_id = $1", [eventId])).toEqual({ n: 1 });
  });

  it("applies snapshot events (the D1 backfill) like creates", async () => {
    await deliver("organization.snapshot", { id: id("o2"), name: "Snapshot Co", slug: "snap", tenantId: null });
    expect(await one("SELECT name, slug FROM organization_readmodel WHERE id = $1", [id("o2")])).toEqual({ name: "Snapshot Co", slug: "snap" });
  });
});
