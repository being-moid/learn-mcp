import { beforeEach, describe, expect, it } from "vitest";
import { AccountEmails } from "../../../../src/application/services/account-emails";
import { InvitationEmailConsumer } from "../../../../src/application/services/invitation-email-consumer";
import type { InvitationStatusReader } from "../../../../src/domain/ports/persistence/invitation-repository";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";
import { FakeEmailSender } from "../../../fakes/recording-email-sender";

describe("InvitationEmailConsumer", () => {
  let sender: FakeEmailSender;
  let statuses: Map<string, { status: string; expiresAt: string }>;
  let consumer: InvitationEmailConsumer;

  const event = (id: string) => ({
    id: `evt-${id}`,
    eventType: "invitation.created",
    occurredAt: "2026-11-27T00:00:00.000Z",
    payload: { id, email: "new@example.com", organizationId: "org-1", inviterId: "ali", role: "member" },
  });

  beforeEach(() => {
    sender = new FakeEmailSender();
    statuses = new Map();
    const reader = new InMemoryMembershipReader();
    reader.memberships.push(membership("ali", "org-1", "owner"));
    const invitations: InvitationStatusReader = { statusOf: async (id) => statuses.get(id) ?? null };
    consumer = new InvitationEmailConsumer({
      memberships: reader,
      invitations,
      emails: new AccountEmails(sender),
      tokens: { tokenFor: async (id) => `token-for-${id}`, matches: async () => false },
      publicUrl: "https://stockroom.example",
      now: () => new Date("2026-11-27T00:00:00Z"),
    });
  });

  it("only handles new invitations, and starts from now", () => {
    expect(consumer.handles("invitation.created")).toBe(true);
    expect(consumer.handles("invitation.status_changed")).toBe(false);
    expect(consumer.handles("user.created")).toBe(false);
    expect(consumer.startFrom).toBe("now");
  });

  it("emails a pending invitation with the accept link and an idempotency key", async () => {
    statuses.set("inv-1", { status: "pending", expiresAt: "2026-11-29T00:00:00.000Z" });
    await consumer.handle(event("inv-1"));
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ category: "invitation", to: "new@example.com", idempotencyKey: "invitation:inv-1" });
    expect(sender.sent[0].subject).toBe("ali invited you to Organization org-1 on Stockroom");
    // The token sits after "#", so the server never sees it in a URL.
    expect(sender.sent[0].text).toContain("https://stockroom.example/accept-invitation?id=inv-1#token=token-for-inv-1");
  });

  it("sends the same idempotency key on a repeat delivery", async () => {
    statuses.set("inv-1", { status: "pending", expiresAt: "2026-11-29T00:00:00.000Z" });
    await consumer.handle(event("inv-1"));
    await consumer.handle(event("inv-1"));
    expect(sender.sent[1].idempotencyKey).toBe(sender.sent[0].idempotencyKey);
  });

  it("sends nothing for an invitation that's gone, no longer pending or expired", async () => {
    statuses.set("accepted", { status: "accepted", expiresAt: "2026-11-29T00:00:00.000Z" });
    statuses.set("expired", { status: "pending", expiresAt: "2026-11-26T00:00:00.000Z" });
    for (const id of ["deleted", "accepted", "expired"]) await consumer.handle(event(id));
    expect(sender.sent).toHaveLength(0);
  });
});
