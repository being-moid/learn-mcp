import { can, type MemberSummary, type Membership } from "../../domain/entities/membership";
import { ForbiddenError, GuardrailError } from "../../domain/errors";
import { DEFAULT_ROLES } from "../../domain/permissions";
import type { Invitation, InvitationRepository } from "../../domain/ports/persistence/invitation-repository";
import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";

// The people in the caller's organization: listing them, and inviting new
// ones. Only ever the caller's own organization: its ID comes from the
// caller's membership, never from input. Invitation emails are sent by the
// outbox relay (InvitationEmailConsumer), not here, so a failed send is
// retried rather than lost.

const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MembersServiceDependencies {
  memberships: MembershipReader;
  invitations: InvitationRepository;
  now?: () => Date;
}

export class MembersService {
  constructor(
    private readonly deps: MembersServiceDependencies,
    private readonly caller: Membership,
  ) {}

  async list(): Promise<MemberSummary[]> {
    this.require("members:read");
    return this.deps.memberships.listMembers(this.caller.organizationId);
  }

  /**
   * Invites someone by email, as a Member or an Admin. The new invitation is
   * recorded in the outbox, which emails it. Inviting an address that already
   * has a pending invitation returns that one (reused: true) without a new email.
   */
  async invite(email: string, role: "admin" | "member"): Promise<{ invitation: Invitation; reused: boolean }> {
    this.require("members:invite");
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address) || address.length > 254) throw new GuardrailError("That doesn't look like an email address.");

    // Guardrail: you can't invite someone into a role with permissions you don't hold.
    const offered = DEFAULT_ROLES.find((r) => r.builtin === role)!;
    const missing = offered.permissions.filter((p) => !can(this.caller, p));
    if (missing.length) throw new GuardrailError(`You can't invite someone as ${offered.name}: it has permissions you don't have (${missing.join(", ")}).`);

    const members = await this.deps.memberships.listMembers(this.caller.organizationId);
    if (members.some((m) => m.email.toLowerCase() === address)) throw new GuardrailError(`${address} is already a member of your organization.`);

    const now = (this.deps.now ?? (() => new Date()))();
    const pending = await this.deps.invitations.findPending(address, now.toISOString());
    const invitation =
      pending ??
      (await this.deps.invitations.create({
        email: address,
        role,
        inviterId: this.caller.userId,
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString(),
        now: now.toISOString(),
      }));
    return { invitation, reused: pending !== null };
  }

  private require(permission: "members:read" | "members:invite"): void {
    if (!can(this.caller, permission)) throw new ForbiddenError(permission);
  }
}
