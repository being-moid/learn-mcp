/**
 * The secret that makes an invitation link work. It goes only into the
 * invitation email: the invitation's ID alone is not enough, because the
 * person who sent the invitation sees that ID (invite_member returns it) and
 * must not be able to use the link to create the invitee's account.
 */
export interface InvitationLinkTokens {
  /** The token for this invitation (the same every time, so a resent email carries the same link). */
  tokenFor(invitationId: string): Promise<string>;
  /** Whether `token` is this invitation's token (checked in constant time). */
  matches(invitationId: string, token: string): Promise<boolean>;
}
