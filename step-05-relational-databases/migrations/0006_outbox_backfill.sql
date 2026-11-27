-- Backfill the outbox, but only if it needs it.
--
-- The Neon read models (step 05) are built by replaying this outbox from the
-- start. That works only if the outbox holds the whole history, which it
-- does whenever the outbox triggers (0004) existed before any data: then
-- every user, company, member and role has its events, and nothing is done
-- here. This step is for a database that had data before its outbox did, or
-- whose outbox was emptied: if the outbox is empty but there is data, the
-- current state of every row is written as one "<table>.snapshot" event
-- each, in an order where parents come first. Replaying those builds the
-- same read models a full history would.
--
-- Snapshots are their own event types, so consumers that react to real
-- changes ignore them: the invitation-email consumer handles only
-- "invitation.created", so no invitation is emailed twice.
--
-- The decision is made once, before the first snapshot is written (after
-- that the outbox isn't empty any more), and kept in a scratch table.

CREATE TABLE "outbox_backfill" ("needed" INTEGER NOT NULL);

INSERT INTO "outbox_backfill" ("needed")
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM "outbox")
  AND (EXISTS (SELECT 1 FROM "user") OR EXISTS (SELECT 1 FROM "tenant") OR EXISTS (SELECT 1 FROM "organization"));

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'tenant', "id", 'tenant.snapshot', json_object('id', "id", 'name', "name"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "tenant" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'user', "id", 'user.snapshot',
       json_object('id', "id", 'name', "name", 'email', "email", 'emailVerified', "emailVerified"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "user" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'tenant', "tenantId", 'tenant_admin.snapshot',
       json_object('tenantId', "tenantId", 'userId', "userId", 'level', "level"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "tenant_admin" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'organization', "id", 'organization.snapshot',
       json_object('id', "id", 'name', "name", 'slug', "slug", 'tenantId', "tenantId"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "organization" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'member', "id", 'member.snapshot',
       json_object('id', "id", 'organizationId', "organizationId", 'userId', "userId", 'role', "role"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "member" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'invitation', "id", 'invitation.snapshot',
       json_object('id', "id", 'organizationId', "organizationId", 'email', "email", 'role', "role",
                   'status', "status", 'inviterId', "inviterId", 'expiresAt', "expiresAt"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "invitation" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'role', "id", 'role.snapshot',
       json_object('id', "id", 'organizationId', "organizationId", 'name', "name", 'builtin', "builtin"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "org_role" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'role', "roleId", 'org_role_permission.snapshot',
       json_object('roleId', "roleId", 'permission', "permission"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "org_role_permission" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

INSERT INTO "outbox" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at")
SELECT lower(hex(randomblob(16))), 'member', "organizationId" || ':' || "userId", 'org_member_role.snapshot',
       json_object('organizationId', "organizationId", 'userId', "userId", 'roleId', "roleId"), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "org_member_role" WHERE EXISTS (SELECT 1 FROM "outbox_backfill");

DROP TABLE "outbox_backfill";
