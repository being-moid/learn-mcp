-- 0006: read models of the auth database (D1), kept up to date from its outbox.
--
-- D1 stays the source of truth for users, companies, members, invitations
-- and roles: Better Auth and our tenancy code write there. Every change is
-- recorded in D1's outbox (D1 migration 0004) in the same transaction, and
-- the outbox relay hands each event to the Neon read-model consumer
-- (src/infrastructure/readmodel/), which applies it here. So Neon gets a
-- copy that business queries can join to (a company's name, who placed
-- what) without reaching into D1, and nothing in Neon is ever written by
-- anything but that consumer.
--
-- Naming: each table is the D1 table's name plus _readmodel, so it's always
-- clear which copy is the record (D1) and which is derived (here).
-- Columns are snake_case versions of D1's; only what the outbox carries is
-- copied (never passwords, sessions, tokens or keys: the outbox doesn't
-- record them).
--
-- No foreign keys between read models: events arrive one at a time, in the
-- log's order, so a row can briefly refer to one that's already been deleted
-- or isn't there yet. D1 enforces the relationships; this is a projection.
--
-- last_seq on every row is the outbox position of the event that last
-- changed it, which makes it easy to see how fresh a row is.

-- Which outbox events have been applied. Inserted in the same transaction as
-- the change, so an event is applied exactly once even if the relay delivers
-- it twice (delivery is at least once): the second insert hits the primary
-- key and the whole transaction is refused. The event ID decides, not seq:
-- a recreated D1 would number its events from 1 again.
CREATE TABLE outbox_inbox (
  event_id    text        PRIMARY KEY,
  seq         bigint      NOT NULL,
  event_type  text        NOT NULL,
  occurred_at timestamptz NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_readmodel (
  id             text    PRIMARY KEY,
  name           text    NOT NULL,
  email          text    NOT NULL,
  email_verified boolean NOT NULL,
  last_seq       bigint  NOT NULL
);

CREATE TABLE tenant_readmodel (
  id       text   PRIMARY KEY,
  name     text   NOT NULL,
  last_seq bigint NOT NULL
);

CREATE TABLE tenant_admin_readmodel (
  tenant_id text   NOT NULL,
  user_id   text   NOT NULL,
  level     text   NOT NULL,
  last_seq  bigint NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

-- id here is the org_id on every sales row.
CREATE TABLE organization_readmodel (
  id        text   PRIMARY KEY,
  name      text   NOT NULL,
  slug      text,
  tenant_id text,
  last_seq  bigint NOT NULL
);

CREATE TABLE member_readmodel (
  id              text   PRIMARY KEY,
  organization_id text   NOT NULL,
  user_id         text   NOT NULL,
  role            text,
  last_seq        bigint NOT NULL
);
CREATE INDEX member_readmodel_organization_idx ON member_readmodel (organization_id);

CREATE TABLE invitation_readmodel (
  id              text   PRIMARY KEY,
  organization_id text   NOT NULL,
  email           text   NOT NULL,
  role            text,
  status          text   NOT NULL DEFAULT 'pending',
  inviter_id      text,
  expires_at      text,
  last_seq        bigint NOT NULL
);
CREATE INDEX invitation_readmodel_organization_idx ON invitation_readmodel (organization_id);

CREATE TABLE org_role_readmodel (
  id              text   PRIMARY KEY,
  organization_id text   NOT NULL,
  name            text   NOT NULL,
  builtin         text,
  last_seq        bigint NOT NULL
);
CREATE INDEX org_role_readmodel_organization_idx ON org_role_readmodel (organization_id);

CREATE TABLE org_role_permission_readmodel (
  role_id    text   NOT NULL,
  permission text   NOT NULL,
  last_seq   bigint NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE org_member_role_readmodel (
  organization_id text   NOT NULL,
  user_id         text   NOT NULL,
  role_id         text   NOT NULL,
  last_seq        bigint NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
