/** An invitation, as the person invited sees it (looked up by its ID, from their email link). */
export interface InvitationDetails {
  id: string;
  organizationId: string;
  email: string;
  role: "admin" | "member";
  status: string;
  expiresAt: string;
  inviterId: string;
}

/**
 * Creating an account from an invitation: the invitation email proved the
 * address, so the person only chooses a password.
 */
export interface InvitationSignUpRepository {
  find(invitationId: string): Promise<InvitationDetails | null>;

  /** Whether someone already has an account with this email address. */
  hasAccount(email: string): Promise<boolean>;

  /**
   * In one transaction: the user (email already confirmed), their password
   * login, their membership with the invited role, and the invitation marked
   * accepted. Returns false, changing nothing, if the invitation is no longer
   * pending or has expired (it can be used only once).
   */
  join(input: { invitationId: string; userId: string; name: string; passwordHash: string; now: string }): Promise<boolean>;
}
