import type { InvitationDetails, InvitationSignUpRepository } from "../../../domain/ports/persistence/invitation-sign-up-repository";

// Accounts created from an invitation, written straight into Better Auth's
// tables ("user", "account", "member", "invitation") in one D1 batch, which
// is a transaction: either the person ends up with a confirmed account in the
// inviting organization and the invitation is used up, or nothing changes.
//
// Not through Better Auth's sign-up, on purpose: that would send a second
// confirmation email, and its user-created hook would give the person a
// personal company of their own. The rows match what Better Auth writes (a
// "credential" account whose accountId is the user ID, its password hash
// format), so Better Auth signs them in like anyone else.
//
// Every statement re-checks that the invitation is still pending and
// unexpired, inside the transaction, so a link can't be used twice even by
// two requests at once.

export class D1InvitationSignUpRepository implements InvitationSignUpRepository {
  constructor(private readonly db: D1Database) {}

  async find(invitationId: string): Promise<InvitationDetails | null> {
    const row = await this.db
      .prepare(
        `SELECT "id", "organizationId", "email", coalesce("role", 'member') AS role, "status", "expiresAt", "inviterId"
           FROM "invitation" WHERE "id" = ?`,
      )
      .bind(invitationId)
      .first<InvitationDetails>();
    return row ?? null;
  }

  async hasAccount(email: string): Promise<boolean> {
    return (await this.db.prepare(`SELECT 1 FROM "user" WHERE lower("email") = lower(?)`).bind(email).first()) !== null;
  }

  async join(input: { invitationId: string; userId: string; name: string; passwordHash: string; now: string }): Promise<boolean> {
    const { invitationId, userId, name, passwordHash, now } = input;
    const usable = `"status" = 'pending' AND "expiresAt" > ?`;
    const results = await this.db.batch([
      // The user, with the invited address, already confirmed by the email link.
      this.db
        .prepare(
          `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
           SELECT ?, ?, lower("email"), 1, ?, ? FROM "invitation" WHERE "id" = ? AND ${usable}`,
        )
        .bind(userId, name, now, now, invitationId, now),
      // Their email-and-password login.
      this.db
        .prepare(
          `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
           SELECT ?, ?, 'credential', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "user" WHERE "id" = ?)`,
        )
        .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now, userId),
      // Their membership, with the role they were invited as.
      this.db
        .prepare(
          `INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
           SELECT ?, "organizationId", ?, coalesce("role", 'member'), ? FROM "invitation"
            WHERE "id" = ? AND ${usable} AND EXISTS (SELECT 1 FROM "user" WHERE "id" = ?)`,
        )
        .bind(crypto.randomUUID(), userId, now, invitationId, now, userId),
      // Used up: the same link can't make a second account.
      this.db
        .prepare(
          `UPDATE "invitation" SET "status" = 'accepted'
            WHERE "id" = ? AND ${usable} AND EXISTS (SELECT 1 FROM "member" WHERE "userId" = ? AND "organizationId" = "invitation"."organizationId")`,
        )
        .bind(invitationId, now, userId),
    ]);
    // An UPDATE that matched nothing reports 0. (Not "=== 1": D1's count also
    // includes the outbox row the invitation trigger writes.)
    return (results[3].meta.changes ?? 0) > 0;
  }
}
