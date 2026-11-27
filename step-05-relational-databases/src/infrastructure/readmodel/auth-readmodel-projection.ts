// Turns one D1 outbox event into the SQL that applies it to the Neon read
// models (db/migrations/0006_auth_readmodels.sql). Pure: no database here, so
// it's unit-tested event by event, and the consumer runs what it returns.
//
// Every statement is fixed SQL with parameters; values come from the event's
// payload, which D1's own triggers wrote (never user input passed through).
//
// Creates and updates are upserts and deletes are plain deletes, so applying
// an event to a row that isn't there (or is already gone) still ends right.
// The `*.snapshot` events come from the D1 backfill (D1 migration 0007): the
// current state of a row, applied like a create.

export interface Statement {
  text: string;
  params: unknown[];
}

export interface ProjectedEvent {
  seq: number;
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

type Payload = Record<string, unknown>;
type Projector = (p: Payload, seq: number) => Statement[];

const text = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
// SQLite has no boolean: emailVerified arrives as 0 or 1.
const bool = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";

const upsertUser: Projector = (p, seq) => [
  {
    text: `INSERT INTO user_readmodel (id, name, email, email_verified, last_seq) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.name), text(p.email), bool(p.emailVerified), seq],
  },
];

const upsertTenant: Projector = (p, seq) => [
  {
    text: `INSERT INTO tenant_readmodel (id, name, last_seq) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.name), seq],
  },
];

const upsertTenantAdmin: Projector = (p, seq) => [
  {
    text: `INSERT INTO tenant_admin_readmodel (tenant_id, user_id, level, last_seq) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET level = EXCLUDED.level, last_seq = EXCLUDED.last_seq`,
    params: [text(p.tenantId), text(p.userId), text(p.level), seq],
  },
];

const upsertOrganization: Projector = (p, seq) => [
  {
    text: `INSERT INTO organization_readmodel (id, name, slug, tenant_id, last_seq) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, tenant_id = EXCLUDED.tenant_id, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.name), text(p.slug), text(p.tenantId), seq],
  },
];

const upsertMember: Projector = (p, seq) => [
  {
    text: `INSERT INTO member_readmodel (id, organization_id, user_id, role, last_seq) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id, role = EXCLUDED.role, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.organizationId), text(p.userId), text(p.role), seq],
  },
];

const upsertInvitation: Projector = (p, seq) => [
  {
    text: `INSERT INTO invitation_readmodel (id, organization_id, email, role, status, inviter_id, expires_at, last_seq)
           VALUES ($1, $2, $3, $4, coalesce($5, 'pending'), $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, email = EXCLUDED.email, role = EXCLUDED.role,
             status = EXCLUDED.status, inviter_id = EXCLUDED.inviter_id, expires_at = EXCLUDED.expires_at, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.organizationId), text(p.email), text(p.role), text(p.status), text(p.inviterId), text(p.expiresAt), seq],
  },
];

const upsertRole: Projector = (p, seq) => [
  {
    text: `INSERT INTO org_role_readmodel (id, organization_id, name, builtin, last_seq) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, name = EXCLUDED.name, builtin = EXCLUDED.builtin, last_seq = EXCLUDED.last_seq`,
    params: [text(p.id), text(p.organizationId), text(p.name), text(p.builtin), seq],
  },
];

const grantPermission: Projector = (p, seq) => [
  {
    text: `INSERT INTO org_role_permission_readmodel (role_id, permission, last_seq) VALUES ($1, $2, $3)
           ON CONFLICT (role_id, permission) DO UPDATE SET last_seq = EXCLUDED.last_seq`,
    params: [text(p.roleId), text(p.permission), seq],
  },
];

const assignMemberRole: Projector = (p, seq) => [
  {
    text: `INSERT INTO org_member_role_readmodel (organization_id, user_id, role_id, last_seq) VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, last_seq = EXCLUDED.last_seq`,
    params: [text(p.organizationId), text(p.userId), text(p.roleId), seq],
  },
];

/** What each event type does to the read models. Event types not listed are skipped. */
const PROJECTORS: Record<string, Projector> = {
  "user.created": upsertUser,
  "user.updated": upsertUser,
  "user.snapshot": upsertUser,
  "user.deleted": (p) => [{ text: "DELETE FROM user_readmodel WHERE id = $1", params: [text(p.id)] }],

  "tenant.created": upsertTenant,
  "tenant.updated": upsertTenant,
  "tenant.snapshot": upsertTenant,
  "tenant.deleted": (p) => [{ text: "DELETE FROM tenant_readmodel WHERE id = $1", params: [text(p.id)] }],
  "tenant.admin_added": upsertTenantAdmin,
  "tenant.admin_changed": upsertTenantAdmin,
  "tenant_admin.snapshot": upsertTenantAdmin,
  "tenant.admin_removed": (p) => [
    { text: "DELETE FROM tenant_admin_readmodel WHERE tenant_id = $1 AND user_id = $2", params: [text(p.tenantId), text(p.userId)] },
  ],

  "organization.created": upsertOrganization,
  "organization.updated": upsertOrganization,
  "organization.snapshot": upsertOrganization,
  "organization.deleted": (p) => [{ text: "DELETE FROM organization_readmodel WHERE id = $1", params: [text(p.id)] }],

  "member.added": upsertMember,
  "member.snapshot": upsertMember,
  "member.role_changed": (p, seq) => [
    { text: "UPDATE member_readmodel SET role = $2, last_seq = $3 WHERE id = $1", params: [text(p.id), text(p.role), seq] },
  ],
  "member.removed": (p) => [{ text: "DELETE FROM member_readmodel WHERE id = $1", params: [text(p.id)] }],
  "member.role_assigned": assignMemberRole,
  "org_member_role.snapshot": assignMemberRole,
  "member.role_unassigned": (p) => [
    { text: "DELETE FROM org_member_role_readmodel WHERE organization_id = $1 AND user_id = $2", params: [text(p.organizationId), text(p.userId)] },
  ],

  "invitation.created": upsertInvitation,
  "invitation.snapshot": upsertInvitation,
  // Its payload has no role or expiry, so only the status changes.
  "invitation.status_changed": (p, seq) => [
    { text: "UPDATE invitation_readmodel SET status = $2, last_seq = $3 WHERE id = $1", params: [text(p.id), text(p.status), seq] },
  ],

  "role.created": upsertRole,
  "role.snapshot": upsertRole,
  "role.renamed": (p, seq) => [
    { text: "UPDATE org_role_readmodel SET name = $2, last_seq = $3 WHERE id = $1", params: [text(p.id), text(p.name), seq] },
  ],
  // A deleted role takes its permissions and assignments with it (D1 cascades
  // the same way, and records those as their own events, which then find nothing).
  "role.deleted": (p) => [
    { text: "DELETE FROM org_role_permission_readmodel WHERE role_id = $1", params: [text(p.id)] },
    { text: "DELETE FROM org_role_readmodel WHERE id = $1", params: [text(p.id)] },
  ],
  "role.permission_granted": grantPermission,
  "org_role_permission.snapshot": grantPermission,
  "role.permission_revoked": (p) => [
    { text: "DELETE FROM org_role_permission_readmodel WHERE role_id = $1 AND permission = $2", params: [text(p.roleId), text(p.permission)] },
  ],
};

export function projects(eventType: string): boolean {
  return eventType in PROJECTORS;
}

/**
 * The statements that apply one event, in one transaction: first the inbox
 * row (refused if the event was applied before), then the change itself.
 */
export function project(event: ProjectedEvent): Statement[] {
  const projector = PROJECTORS[event.eventType];
  if (!projector) return [];
  return [
    {
      text: "INSERT INTO outbox_inbox (event_id, seq, event_type, occurred_at) VALUES ($1, $2, $3, $4)",
      params: [event.id, event.seq, event.eventType, event.occurredAt],
    },
    ...projector(event.payload, event.seq),
  ];
}
