import type { InvitationLinkTokens } from "../../domain/ports/auth/invitation-link-tokens";
import type { OutboxConsumer } from "../../domain/ports/outbox/outbox-consumer";
import type { InvitationStatusReader } from "../../domain/ports/persistence/invitation-repository";
import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";
import type { AccountEmails } from "./account-emails";

// Emails each new invitation, from the outbox. Every invitation (made by
// invite_member or through Better Auth) is emailed exactly once: the outbox
// records it when the invitation row is created, and the email's idempotency
// key is the invitation ID, so a repeated delivery isn't sent twice.

export interface InvitationEmailConsumerDependencies {
  memberships: MembershipReader;
  invitations: InvitationStatusReader;
  emails: AccountEmails;
  /** The link's secret, so only the person who got the email can use it. */
  tokens: InvitationLinkTokens;
  /** This server's public address, for the accept link. */
  publicUrl: string;
  now?: () => Date;
}

export class InvitationEmailConsumer implements OutboxConsumer {
  readonly name = "invitation-email";
  // New invitations only: registering this consumer must not email old ones.
  readonly startFrom = "now" as const;

  constructor(private readonly deps: InvitationEmailConsumerDependencies) {}

  handles(eventType: string): boolean {
    return eventType === "invitation.created";
  }

  async handle(event: { payload: Record<string, unknown> }): Promise<void> {
    const { id, email, organizationId, inviterId } = event.payload as { id: string; email: string; organizationId: string; inviterId: string };

    // Accepted, declined, cancelled or expired before we got to it: nothing to send.
    const current = await this.deps.invitations.statusOf(id);
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    if (!current || current.status !== "pending" || current.expiresAt <= now) return;

    const members = await this.deps.memberships.listMembers(organizationId);
    await this.deps.emails.sendInvitation({
      to: email,
      organizationName: (await this.deps.memberships.organizationName(organizationId)) ?? "an organization",
      inviterName: members.find((m) => m.userId === inviterId)?.name ?? "",
      // The token goes after "#": browsers never send that part to the server,
      // so it stays out of request logs.
      url: `${this.deps.publicUrl}/accept-invitation?id=${encodeURIComponent(id)}#token=${await this.deps.tokens.tokenFor(id)}`,
      invitationId: id,
    });
  }
}
