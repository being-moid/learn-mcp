import { describe, expect, it } from "vitest";
import { project, projects } from "../../../src/infrastructure/readmodel/auth-readmodel-projection";
import { NeonReadModelConsumer } from "../../../src/infrastructure/readmodel/neon-readmodel-consumer";

const event = (eventType: string, payload: Record<string, unknown>, seq = 7) => ({ seq, id: `evt-${seq}`, eventType, payload, occurredAt: "2026-11-28T00:00:00.000Z" });

describe("auth read-model projection", () => {
  it("records the event in the inbox first, then upserts the row", () => {
    const statements = project(event("user.created", { id: "u1", name: "Ana", email: "ana@example.com", emailVerified: 1 }));
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toContain("INSERT INTO outbox_inbox");
    expect(statements[0].params).toEqual(["evt-7", 7, "user.created", "2026-11-28T00:00:00.000Z"]);
    expect(statements[1].text).toContain("INSERT INTO user_readmodel");
    expect(statements[1].text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(statements[1].params).toEqual(["u1", "Ana", "ana@example.com", true, 7]);
  });

  it("projects snapshots like creates, and deletes as deletes", () => {
    expect(project(event("organization.snapshot", { id: "o1", name: "Acme", slug: "acme", tenantId: "t1" }))[1].params).toEqual(["o1", "Acme", "acme", "t1", 7]);
    expect(project(event("member.removed", { id: "m1", organizationId: "o1", userId: "u1" }))[1]).toEqual({ text: "DELETE FROM member_readmodel WHERE id = $1", params: ["m1"] });
    expect(project(event("role.deleted", { id: "r1", organizationId: "o1" })).map((s) => s.text)).toEqual([
      "INSERT INTO outbox_inbox (event_id, seq, event_type, occurred_at) VALUES ($1, $2, $3, $4)",
      "DELETE FROM org_role_permission_readmodel WHERE role_id = $1",
      "DELETE FROM org_role_readmodel WHERE id = $1",
    ]);
  });

  it("skips event types it doesn't know", () => {
    expect(projects("user.created")).toBe(true);
    expect(projects("something.else")).toBe(false);
    expect(project(event("something.else", {}))).toEqual([]);
  });
});

describe("NeonReadModelConsumer", () => {
  it("treats a repeat delivery (the inbox already has the event) as done", async () => {
    const consumer = new NeonReadModelConsumer(async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint "outbox_inbox_pkey"'), { code: "23505", constraint: "outbox_inbox_pkey" });
    });
    await expect(consumer.handle(event("user.created", { id: "u1" }))).resolves.toBeUndefined();
  });

  it("rethrows any other failure, so the relay retries the event", async () => {
    const consumer = new NeonReadModelConsumer(async () => {
      throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    });
    await expect(consumer.handle(event("user.created", { id: "u1" }))).rejects.toThrow("connection refused");
  });

  it("starts from the beginning of the log, so a new Neon gets the whole history", () => {
    const consumer = new NeonReadModelConsumer(async () => {});
    expect(consumer.startFrom).toBe("beginning");
    expect(consumer.name).toBe("neon-readmodel");
  });
});
