-- Tenancy and per-organization roles (our tables; Better Auth's are in 0001).
--
--   tenant                a customer account; owns one or more organizations
--   tenant_admin          who manages a tenant (owner or admin of the account)
--   org_role              roles an organization defines; names chosen per organization
--   org_role_permission   which fixed permissions each role grants
--
-- The organization is the data-isolation boundary; a tenant groups
-- organizations for management only (see PLAN.md, "Hierarchy").
-- Applied with: npx wrangler d1 migrations apply AUTH_DB --local | --remote

CREATE TABLE "tenant" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE TABLE "tenant_admin" (
  "tenantId" TEXT NOT NULL REFERENCES "tenant" ("id") ON DELETE CASCADE,
  "userId"   TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "level"    TEXT NOT NULL CHECK ("level" IN ('owner', 'admin')),
  PRIMARY KEY ("tenantId", "userId")
);
CREATE INDEX "tenant_admin_userId_idx" ON "tenant_admin" ("userId");

CREATE TABLE "org_role" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"           TEXT NOT NULL,
  -- Which built-in role this is ('owner', 'admin', 'member'), or NULL for a
  -- role the organization created. Built-in roles can be renamed, not removed.
  "builtin"        TEXT CHECK ("builtin" IN ('owner', 'admin', 'member')),
  "createdAt"      TEXT NOT NULL,
  UNIQUE ("organizationId", "name"),
  UNIQUE ("organizationId", "builtin")
);

CREATE TABLE "org_role_permission" (
  "roleId"     TEXT NOT NULL REFERENCES "org_role" ("id") ON DELETE CASCADE,
  "permission" TEXT NOT NULL,
  PRIMARY KEY ("roleId", "permission")
);
