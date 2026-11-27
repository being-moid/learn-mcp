import type { Membership } from "../../src/domain/entities/membership";
import { DEFAULT_ROLES, type Permission } from "../../src/domain/permissions";

/** A test membership with one of the built-in roles and its default permissions (or `permissions` if given). */
export function membership(
  userId: string,
  organizationId: string,
  builtin: "owner" | "admin" | "member" = "member",
  permissions?: readonly Permission[],
): Membership {
  const role = DEFAULT_ROLES.find((r) => r.builtin === builtin)!;
  return {
    userId,
    organizationId,
    tenantId: null,
    role: { id: `${organizationId}-${builtin}`, name: role.name, builtin },
    permissions: permissions ?? role.permissions,
  };
}
