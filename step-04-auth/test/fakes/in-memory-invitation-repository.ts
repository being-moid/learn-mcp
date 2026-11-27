import type { Invitation, InvitationRepository } from "../../src/domain/ports/persistence/invitation-repository";

/** An in-memory InvitationRepository for one organization, for unit tests. */
export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations: Invitation[] = [];
  constructor(readonly organizationId = "org-1") {}

  async findPending(email: string, now: string): Promise<Invitation | null> {
    return this.invitations.find((i) => i.email === email && i.expiresAt > now) ?? null;
  }

  async create(input: { email: string; role: "admin" | "member"; expiresAt: string }): Promise<Invitation> {
    const invitation = { id: `inv-${this.invitations.length + 1}`, organizationId: this.organizationId, email: input.email, role: input.role, expiresAt: input.expiresAt };
    this.invitations.push(invitation);
    return invitation;
  }
}
