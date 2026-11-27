import { beforeEach, describe, expect, it } from "vitest";
import { MembersService } from "../../../../src/application/services/members-service";
import { ForbiddenError, GuardrailError } from "../../../../src/domain/errors";
import { InMemoryInvitationRepository } from "../../../fakes/in-memory-invitation-repository";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";

describe("MembersService", () => {
  let reader: InMemoryMembershipReader;
  let invitations: InMemoryInvitationRepository;
  const service = (caller = membership("ali", "org-1", "owner")) =>
    new MembersService(
      { memberships: reader, invitations, now: () => new Date("2026-11-27T00:00:00Z") },
      caller,
    );

  beforeEach(() => {
    reader = new InMemoryMembershipReader();
    reader.memberships.push(membership("ali", "org-1", "owner"), membership("sara", "org-1", "member"), membership("zed", "org-2", "owner"));
    invitations = new InMemoryInvitationRepository();
  });

  it("lists only the caller's own organization", async () => {
    expect((await service().list()).map((m) => m.userId)).toEqual(["ali", "sara"]);
  });

  it("refuses to list or invite without the permission", async () => {
    const member = service(membership("sara", "org-1", "member"));
    await expect(member.list()).rejects.toThrow(ForbiddenError);
    await expect(member.invite("new@example.com", "member")).rejects.toThrow(ForbiddenError);
  });

  it("records an invitation for a normalized address, expiring in 48 hours", async () => {
    // No email here: the outbox relay sends it (InvitationEmailConsumer).
    const { invitation, reused } = await service().invite("  New.Person@Example.com ", "member");
    expect(reused).toBe(false);
    expect(invitation).toMatchObject({ email: "new.person@example.com", role: "member", expiresAt: "2026-11-29T00:00:00.000Z" });
    expect(invitations.invitations).toHaveLength(1);
  });

  it("reuses a pending invitation instead of creating another", async () => {
    const first = await service().invite("new@example.com", "member");
    const second = await service().invite("new@example.com", "member");
    expect(second).toEqual({ invitation: first.invitation, reused: true });
    expect(invitations.invitations).toHaveLength(1);
  });

  it("won't let someone invite as Admin without every Admin permission", async () => {
    const limited = service(membership("ali", "org-1", "admin", ["members:read", "members:invite"]));
    await expect(limited.invite("new@example.com", "admin")).rejects.toThrow(/as Admin/);
    await expect(limited.invite("new@example.com", "member")).rejects.toThrow(/as Member/); // Member also needs sales:read
  });

  it("refuses an existing member and a malformed address", async () => {
    await expect(service().invite("sara@example.com", "member")).rejects.toThrow(/already a member/);
    await expect(service().invite("not-an-email", "member")).rejects.toThrow(GuardrailError);
  });
});
