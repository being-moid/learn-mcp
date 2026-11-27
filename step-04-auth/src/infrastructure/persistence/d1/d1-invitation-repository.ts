import type { Invitation, InvitationRepository, InvitationStatusReader } from "../../../domain/ports/persistence/invitation-repository";

// InvitationRepository on D1, for ONE organization. It writes Better Auth's
// own "invitation" table (in Better Auth's format), so Better Auth's accept
// flow and its checks (status, expiry, matching and confirmed email) work on
// invitations created here. Better Auth's API can't be used for this from an
// MCP call: it needs the inviter's browser session, and the call carries an
// access token instead.
export class D1InvitationRepository implements InvitationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly organizationId: string,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async findPending(email: string, now: string): Promise<Invitation | null> {
    return this.db
      .prepare(
        `SELECT "id", "organizationId", "email", "role", "expiresAt" FROM "invitation"
          WHERE "organizationId" = ? AND lower("email") = lower(?) AND "status" = 'pending' AND "expiresAt" > ?
          ORDER BY "createdAt" DESC LIMIT 1`,
      )
      .bind(this.organizationId, email, now)
      .first<Invitation>();
  }

  async create(input: { email: string; role: "admin" | "member"; inviterId: string; expiresAt: string; now: string }): Promise<Invitation> {
    const invitation: Invitation = { id: this.newId(), organizationId: this.organizationId, email: input.email, role: input.role, expiresAt: input.expiresAt };
    await this.db
      .prepare(
        `INSERT INTO "invitation" ("id", "organizationId", "email", "role", "status", "expiresAt", "createdAt", "inviterId")
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(invitation.id, this.organizationId, input.email, input.role, input.expiresAt, input.now, input.inviterId)
      .run();
    return invitation;
  }
}

/** InvitationStatusReader on D1, for the outbox relay (any organization, by invitation ID). */
export class D1InvitationStatusReader implements InvitationStatusReader {
  constructor(private readonly db: D1Database) {}

  async statusOf(invitationId: string): Promise<{ status: string; expiresAt: string } | null> {
    return this.db.prepare(`SELECT "status", "expiresAt" FROM "invitation" WHERE "id" = ?`).bind(invitationId).first<{ status: string; expiresAt: string }>();
  }
}
