import { GuardrailError, NotFoundError } from "../../domain/errors";
import type { InvitationLinkTokens } from "../../domain/ports/auth/invitation-link-tokens";
import type { PasswordHasher } from "../../domain/ports/auth/password-hasher";
import type { InvitationDetails, InvitationSignUpRepository } from "../../domain/ports/persistence/invitation-sign-up-repository";
import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";

// Joining an organization from an invitation email, for someone who has no
// account yet. Opening the emailed link proves they own the address (only
// the email carries the link's secret token), so all they choose is a
// password: no form to retype their email, no second confirmation email.
// They join the inviting organization only; they don't get a company of
// their own.
//
// Someone who already has an account signs in and accepts instead (the
// /accept-invitation page handles both).

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

const INVALID_LINK = "This invitation link isn't valid any more: it may have been used already, cancelled, or expired. Ask for a new invitation.";

export interface InvitationPreview {
  email: string;
  organizationName: string;
  inviterName: string;
  role: "admin" | "member";
  /** True if the address already has an account: sign in and accept instead of choosing a password. */
  hasAccount: boolean;
}

export interface InvitationSignUpDependencies {
  invitations: InvitationSignUpRepository;
  tokens: InvitationLinkTokens;
  passwords: PasswordHasher;
  memberships: MembershipReader;
  now?: () => Date;
  newId?: () => string;
}

export class InvitationSignUpService {
  constructor(private readonly deps: InvitationSignUpDependencies) {}

  /** What the invitation page shows: who invited whom, to what. */
  async preview(invitationId: string, token: string): Promise<InvitationPreview> {
    const invitation = await this.usable(invitationId, token);
    const members = await this.deps.memberships.listMembers(invitation.organizationId);
    return {
      email: invitation.email,
      organizationName: (await this.deps.memberships.organizationName(invitation.organizationId)) ?? "an organization",
      inviterName: members.find((m) => m.userId === invitation.inviterId)?.name ?? "",
      role: invitation.role,
      hasAccount: await this.deps.invitations.hasAccount(invitation.email),
    };
  }

  /** Creates the account with the chosen password and joins the organization; returns the email to sign in with. */
  async join(invitationId: string, token: string, password: string): Promise<{ email: string; organizationName: string }> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new GuardrailError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password.length > MAX_PASSWORD_LENGTH) throw new GuardrailError(`Choose a password of at most ${MAX_PASSWORD_LENGTH} characters.`);

    const invitation = await this.usable(invitationId, token);
    if (await this.deps.invitations.hasAccount(invitation.email)) {
      throw new GuardrailError(`${invitation.email} already has a Stockroom account. Sign in with it to accept the invitation.`);
    }

    const joined = await this.deps.invitations.join({
      invitationId,
      userId: (this.deps.newId ?? (() => crypto.randomUUID()))(),
      name: (invitation.email.split("@")[0] || "New member").slice(0, 100),
      passwordHash: await this.deps.passwords.hash(password),
      now: this.now(),
    });
    if (!joined) throw new NotFoundError(INVALID_LINK); // used or cancelled a moment ago
    return {
      email: invitation.email,
      organizationName: (await this.deps.memberships.organizationName(invitation.organizationId)) ?? "the organization",
    };
  }

  /** The invitation, if the token is right and it can still be used. One message for every failure, so nothing leaks. */
  private async usable(invitationId: string, token: string): Promise<InvitationDetails> {
    if (!invitationId || !token || !(await this.deps.tokens.matches(invitationId, token))) throw new NotFoundError(INVALID_LINK);
    const invitation = await this.deps.invitations.find(invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= this.now()) throw new NotFoundError(INVALID_LINK);
    return invitation;
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}
