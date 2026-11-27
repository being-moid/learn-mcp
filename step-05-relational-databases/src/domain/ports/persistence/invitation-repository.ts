/** A pending invitation to join an organization. */
export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
}

/**
 * Looks up any invitation's current status, by ID. Used by the outbox relay,
 * which isn't acting for a caller (so isn't limited to one organization).
 */
export interface InvitationStatusReader {
  /** The invitation's status and expiry, or null if it no longer exists. */
  statusOf(invitationId: string): Promise<{ status: string; expiresAt: string } | null>;
}

/** Invitations to ONE organization (an instance is built for a single organization). */
export interface InvitationRepository {
  /** A pending, unexpired invitation for this address, if there is one. */
  findPending(email: string, now: string): Promise<Invitation | null>;
  create(input: { email: string; role: "admin" | "member"; inviterId: string; expiresAt: string; now: string }): Promise<Invitation>;
}
