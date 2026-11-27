-- Which of its organization's roles each member has.
--
-- A member with no row here has the built-in role matching Better Auth's
-- "member"."role" ('owner', 'admin' or 'member'). Assigning one of the
-- organization's own roles adds a row; Better Auth's coarse role is kept in
-- step (see D1RoleRepository.assign) so its own permission checks agree.
-- Applied with: npx wrangler d1 migrations apply AUTH_DB --local | --remote

CREATE TABLE "org_member_role" (
  "organizationId" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "userId"         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "roleId"         TEXT NOT NULL REFERENCES "org_role" ("id") ON DELETE CASCADE,
  PRIMARY KEY ("organizationId", "userId")
);
CREATE INDEX "org_member_role_roleId_idx" ON "org_member_role" ("roleId");
