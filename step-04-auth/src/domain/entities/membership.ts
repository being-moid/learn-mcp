import type { Permission } from "../permissions";

// A user's membership of one organization, as it is right now: their role and
// what it lets them do. Looked up on every request, so a removal or a role
// change takes effect on the next call even while their access token is valid.

export interface MemberRole {
  id: string;
  name: string;
  /** 'owner', 'admin' or 'member' for a built-in role; null for one the organization created. */
  builtin: "owner" | "admin" | "member" | null;
}

export interface Membership {
  userId: string;
  organizationId: string;
  /** The tenant that owns the organization; null until onboarding links it. */
  tenantId: string | null;
  role: MemberRole;
  permissions: readonly Permission[];
}

/** Whether the membership grants `permission`. */
export function can(membership: Membership, permission: Permission): boolean {
  return membership.permissions.includes(permission);
}

/** A member as an admin sees them in a list. */
export interface MemberSummary {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
}
