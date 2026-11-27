-- The outbox: every change to users, tenants, organizations, memberships,
-- invitations and roles is recorded here by a trigger, in the SAME
-- transaction as the change. So an event exists if and only if its change
-- committed: a rolled-back change leaves no event, and a committed one can't
-- lose its event. (Checked on local and remote D1 in stage 0.)
--
-- The outbox is an ordered log. Nothing is sent here: a background relay
-- (src/application/services/outbox-relay.ts) delivers events to each consumer
-- in order, and "outbox_consumer" records how far each consumer has got.
-- Every consumer moves at its own pace: a new one can start from the
-- beginning (Neon in step 05 gets the full history) or from now (email
-- doesn't resend old invitations), and one that keeps failing holds up only
-- itself.
--
-- Payloads carry only what other systems need. Never recorded: passwords,
-- sessions, OAuth tokens or secrets, verification tokens, signing keys. That
-- is why there are no triggers on "account", "session", "verification",
-- "jwks" or the "oauth*" tables.
-- Applied with: npx wrangler d1 migrations apply AUTH_DB --local | --remote

CREATE TABLE "outbox" (
  "seq"            INTEGER PRIMARY KEY AUTOINCREMENT, -- position in the log; delivery order
  "id"             TEXT NOT NULL UNIQUE,              -- event ID: consumers' idempotency key
  "aggregate_type" TEXT NOT NULL,                     -- user | tenant | organization | member | invitation | role
  "aggregate_id"   TEXT NOT NULL,
  "event_type"     TEXT NOT NULL,                     -- e.g. user.created, member.role_changed
  "payload"        TEXT NOT NULL,                     -- JSON
  "occurred_at"    TEXT NOT NULL
);

CREATE TABLE "outbox_consumer" (
  "name"       TEXT NOT NULL PRIMARY KEY,  -- e.g. 'invitation-email', 'neon-inbox'
  "last_seq"   INTEGER NOT NULL DEFAULT 0, -- the last event this consumer has handled
  "attempts"   INTEGER NOT NULL DEFAULT 0, -- failed tries at the next event
  "last_error" TEXT,
  "failed_at"  TEXT,                       -- set after too many failures: stopped until a person resets it
  "updated_at" TEXT NOT NULL
);

-- Register the invitation-email consumer now, at the start of the (still
-- empty) log, so no invitation made after this migration can be missed,
-- even one made before the relay first runs.
INSERT INTO "outbox_consumer" ("name", "last_seq", "updated_at")
VALUES ('invitation-email', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- users (Better Auth). Never the password: that lives in "account", untouched.
CREATE TRIGGER "outbox_user_created" AFTER INSERT ON "user" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'user', NEW."id", 'user.created',
          json_object('id', NEW."id", 'name', NEW."name", 'email', NEW."email", 'emailVerified', NEW."emailVerified"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_user_updated" AFTER UPDATE OF "name", "email", "emailVerified" ON "user" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'user', NEW."id", 'user.updated',
          json_object('id', NEW."id", 'name', NEW."name", 'email', NEW."email", 'emailVerified', NEW."emailVerified"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_user_deleted" AFTER DELETE ON "user" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'user', OLD."id", 'user.deleted', json_object('id', OLD."id"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- organizations (Better Auth, plus our tenantId)
CREATE TRIGGER "outbox_organization_created" AFTER INSERT ON "organization" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'organization', NEW."id", 'organization.created',
          json_object('id', NEW."id", 'name', NEW."name", 'slug', NEW."slug", 'tenantId', NEW."tenantId"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_organization_updated" AFTER UPDATE OF "name", "slug", "tenantId" ON "organization" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'organization', NEW."id", 'organization.updated',
          json_object('id', NEW."id", 'name', NEW."name", 'slug', NEW."slug", 'tenantId', NEW."tenantId"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_organization_deleted" AFTER DELETE ON "organization" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'organization', OLD."id", 'organization.deleted', json_object('id', OLD."id"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- memberships (Better Auth)
CREATE TRIGGER "outbox_member_added" AFTER INSERT ON "member" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', NEW."id", 'member.added',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'userId', NEW."userId", 'role', NEW."role"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_member_role_changed" AFTER UPDATE OF "role" ON "member" WHEN OLD."role" IS NOT NEW."role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', NEW."id", 'member.role_changed',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'userId', NEW."userId", 'role', NEW."role", 'previousRole', OLD."role"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_member_removed" AFTER DELETE ON "member" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', OLD."id", 'member.removed',
          json_object('id', OLD."id", 'organizationId', OLD."organizationId", 'userId', OLD."userId"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- invitations (Better Auth's table; created by Better Auth or by invite_member)
CREATE TRIGGER "outbox_invitation_created" AFTER INSERT ON "invitation" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'invitation', NEW."id", 'invitation.created',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'email', NEW."email", 'role', NEW."role",
                      'inviterId', NEW."inviterId", 'expiresAt', NEW."expiresAt"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_invitation_status_changed" AFTER UPDATE OF "status" ON "invitation" WHEN OLD."status" IS NOT NEW."status" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'invitation', NEW."id", 'invitation.status_changed',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'email', NEW."email", 'status', NEW."status"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- tenants and their admins (ours)
CREATE TRIGGER "outbox_tenant_created" AFTER INSERT ON "tenant" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', NEW."id", 'tenant.created', json_object('id', NEW."id", 'name', NEW."name"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_tenant_updated" AFTER UPDATE OF "name" ON "tenant" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', NEW."id", 'tenant.updated', json_object('id', NEW."id", 'name', NEW."name"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_tenant_deleted" AFTER DELETE ON "tenant" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', OLD."id", 'tenant.deleted', json_object('id', OLD."id"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_tenant_admin_added" AFTER INSERT ON "tenant_admin" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', NEW."tenantId", 'tenant.admin_added',
          json_object('tenantId', NEW."tenantId", 'userId', NEW."userId", 'level', NEW."level"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_tenant_admin_changed" AFTER UPDATE OF "level" ON "tenant_admin" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', NEW."tenantId", 'tenant.admin_changed',
          json_object('tenantId', NEW."tenantId", 'userId', NEW."userId", 'level', NEW."level"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_tenant_admin_removed" AFTER DELETE ON "tenant_admin" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'tenant', OLD."tenantId", 'tenant.admin_removed',
          json_object('tenantId', OLD."tenantId", 'userId', OLD."userId"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- organization roles (ours). A role and its permissions are one aggregate.
CREATE TRIGGER "outbox_role_created" AFTER INSERT ON "org_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'role', NEW."id", 'role.created',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'name', NEW."name", 'builtin', NEW."builtin"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_role_renamed" AFTER UPDATE OF "name" ON "org_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'role', NEW."id", 'role.renamed',
          json_object('id', NEW."id", 'organizationId', NEW."organizationId", 'name', NEW."name"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_role_deleted" AFTER DELETE ON "org_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'role', OLD."id", 'role.deleted',
          json_object('id', OLD."id", 'organizationId', OLD."organizationId"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_role_permission_granted" AFTER INSERT ON "org_role_permission" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'role', NEW."roleId", 'role.permission_granted',
          json_object('roleId', NEW."roleId", 'permission', NEW."permission"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_role_permission_revoked" AFTER DELETE ON "org_role_permission" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'role', OLD."roleId", 'role.permission_revoked',
          json_object('roleId', OLD."roleId", 'permission', OLD."permission"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- which role each member has (ours)
CREATE TRIGGER "outbox_member_role_assigned" AFTER INSERT ON "org_member_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', NEW."organizationId" || ':' || NEW."userId", 'member.role_assigned',
          json_object('organizationId', NEW."organizationId", 'userId', NEW."userId", 'roleId', NEW."roleId"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_member_role_reassigned" AFTER UPDATE OF "roleId" ON "org_member_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', NEW."organizationId" || ':' || NEW."userId", 'member.role_assigned',
          json_object('organizationId', NEW."organizationId", 'userId', NEW."userId", 'roleId', NEW."roleId"),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER "outbox_member_role_unassigned" AFTER DELETE ON "org_member_role" BEGIN
  INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
  VALUES (lower(hex(randomblob(16))), 'member', OLD."organizationId" || ':' || OLD."userId", 'member.role_unassigned',
          json_object('organizationId', OLD."organizationId", 'userId', OLD."userId"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
