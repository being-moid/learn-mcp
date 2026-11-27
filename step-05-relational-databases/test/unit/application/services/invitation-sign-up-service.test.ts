import { beforeEach, describe, expect, it } from "vitest";
import { InvitationSignUpService } from "../../../../src/application/services/invitation-sign-up-service";
import { GuardrailError, NotFoundError } from "../../../../src/domain/errors";
import type { InvitationDetails, InvitationSignUpRepository } from "../../../../src/domain/ports/persistence/invitation-sign-up-repository";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";

/** Invitations and accounts in memory; join() behaves like the D1 transaction. */
class FakeInvitations implements InvitationSignUpRepository {
  readonly invitations = new Map<string, InvitationDetails>();
  readonly accounts = new Map<string, { userId: string; name: string; passwordHash: string }>();
  async find(id: string) {
    return this.invitations.get(id) ?? null;
  }
  async hasAccount(email: string) {
    return this.accounts.has(email);
  }
  async join(input: { invitationId: string; userId: string; name: string; passwordHash: string; now: string }) {
    const invitation = this.invitations.get(input.invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= input.now) return false;
    this.accounts.set(invitation.email, { userId: input.userId, name: input.name, passwordHash: input.passwordHash });
    invitation.status = "accepted";
    return true;
  }
}

const VALID = "the-right-token";

describe("InvitationSignUpService", () => {
  let invitations: FakeInvitations;
  let service: InvitationSignUpService;

  beforeEach(() => {
    invitations = new FakeInvitations();
    invitations.invitations.set("inv-1", {
      id: "inv-1", organizationId: "org-1", email: "new.person@example.com", role: "member",
      status: "pending", expiresAt: "2026-11-29T00:00:00.000Z", inviterId: "ali",
    });
    const reader = new InMemoryMembershipReader();
    reader.memberships.push(membership("ali", "org-1", "owner"));
    service = new InvitationSignUpService({
      invitations,
      tokens: { tokenFor: async () => VALID, matches: async (_id, token) => token === VALID },
      passwords: { hash: async (p) => `hashed:${p}` },
      memberships: reader,
      now: () => new Date("2026-11-27T00:00:00Z"),
      newId: () => "user-new",
    });
  });

  it("previews the invitation for the right token", async () => {
    expect(await service.preview("inv-1", VALID)).toEqual({
      email: "new.person@example.com", organizationName: "Organization org-1", inviterName: "ali", role: "member", hasAccount: false,
    });
  });

  it("creates the account with only a password, named from the email, and uses up the invitation", async () => {
    expect(await service.join("inv-1", VALID, "correct-horse-battery")).toEqual({ email: "new.person@example.com", organizationName: "Organization org-1" });
    expect(invitations.accounts.get("new.person@example.com")).toEqual({ userId: "user-new", name: "new.person", passwordHash: "hashed:correct-horse-battery" });
    // The same link can't be used again.
    await expect(service.join("inv-1", VALID, "correct-horse-battery")).rejects.toThrow(NotFoundError);
  });

  it("refuses a wrong or missing token with the same message as any other bad link", async () => {
    const wrong = await service.preview("inv-1", "guess").catch((e: Error) => e);
    const missing = await service.preview("inv-1", "").catch((e: Error) => e);
    const unknown = await service.preview("inv-9", VALID).catch((e: Error) => e);
    expect(wrong).toBeInstanceOf(NotFoundError);
    expect((missing as Error).message).toBe((wrong as Error).message);
    expect((unknown as Error).message).toBe((wrong as Error).message);
    await expect(service.join("inv-1", "guess", "correct-horse-battery")).rejects.toThrow(NotFoundError);
    expect(invitations.accounts.size).toBe(0);
  });

  it("refuses an expired, cancelled or accepted invitation", async () => {
    for (const change of [{ expiresAt: "2026-11-26T00:00:00.000Z" }, { status: "canceled" }, { status: "accepted" }]) {
      Object.assign(invitations.invitations.get("inv-1")!, { status: "pending", expiresAt: "2026-11-29T00:00:00.000Z" }, change);
      await expect(service.preview("inv-1", VALID)).rejects.toThrow(NotFoundError);
    }
  });

  it("sends someone who already has an account to sign in instead", async () => {
    invitations.accounts.set("new.person@example.com", { userId: "x", name: "x", passwordHash: "x" });
    expect((await service.preview("inv-1", VALID)).hasAccount).toBe(true);
    await expect(service.join("inv-1", VALID, "correct-horse-battery")).rejects.toThrow(/already has a Stockroom account/);
  });

  it("enforces the password length before touching the invitation", async () => {
    await expect(service.join("inv-1", VALID, "short")).rejects.toThrow(GuardrailError);
    await expect(service.join("inv-1", VALID, "x".repeat(129))).rejects.toThrow(GuardrailError);
    expect(invitations.invitations.get("inv-1")!.status).toBe("pending");
  });
});
