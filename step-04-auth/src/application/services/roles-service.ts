import { can, type Membership } from "../../domain/entities/membership";
import type { Role } from "../../domain/entities/role";
import { ForbiddenError, GuardrailError, NotFoundError } from "../../domain/errors";
import { DEFAULT_ROLES, isPermission, type Permission } from "../../domain/permissions";
import type { RoleRepository } from "../../domain/ports/persistence/role-repository";

// Roles inside the caller's organization: listing, creating, changing what a
// role allows, and giving a member a role. The repository passed in is built
// for the caller's organization only, so nothing here can reach another's.
//
// Guardrails (each one tested):
//   1. You can't grant a permission you don't hold yourself.
//   2. An organization always keeps at least one Owner.
//   3. The built-in Owner role can't lose permissions.
//   4. Only an Owner can make someone an Owner (an Admin holds every
//      permission, so rule 1 alone would let an Admin promote anyone).

const MAX_ROLE_NAME = 50;

export class RolesService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly caller: Membership,
  ) {}

  async list(): Promise<Role[]> {
    this.require("members:read");
    return this.roles.list();
  }

  async create(name: string, permissions: readonly string[]): Promise<Role> {
    this.require("roles:manage");
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > MAX_ROLE_NAME) throw new GuardrailError(`A role name must be 1 to ${MAX_ROLE_NAME} characters.`);
    if (await this.roles.findByName(cleanName)) throw new GuardrailError(`Your organization already has a role called "${cleanName}".`);
    const granted = this.grantable(permissions);
    return this.roles.create({ name: cleanName, permissions: granted });
  }

  async setPermissions(roleId: string, permissions: readonly string[]): Promise<Role> {
    this.require("roles:manage");
    const role = await this.existing(roleId);
    if (role.builtin === "owner") throw new GuardrailError("The Owner role always has every permission; it can't be changed.");
    const granted = this.grantable(permissions);
    await this.roles.setPermissions(role.id, granted);
    return { ...role, permissions: granted };
  }

  async assign(userId: string, roleId: string): Promise<Role> {
    this.require("roles:manage");
    const role = await this.existing(roleId);
    const current = await this.roles.roleOf(userId);
    if (!current) throw new NotFoundError("That person isn't a member of your organization.");

    if (role.builtin === "owner" && this.caller.role.builtin !== "owner") {
      throw new GuardrailError("Only an Owner can make someone an Owner.");
    }
    this.grantable(role.permissions); // you can't give someone more than you have
    if (current.builtin === "owner" && role.builtin !== "owner" && (await this.roles.countOwners()) <= 1) {
      throw new GuardrailError("Your organization must keep at least one Owner. Make someone else an Owner first.");
    }
    await this.roles.assign(userId, role);
    return role;
  }

  private require(permission: Permission): void {
    if (!can(this.caller, permission)) throw new ForbiddenError(permission);
  }

  private async existing(roleId: string): Promise<Role> {
    const role = await this.roles.get(roleId);
    if (!role) throw new NotFoundError("No role with that ID in your organization. Call list_roles to see the roles that exist.");
    return role;
  }

  /** Validates a permission list and checks the caller holds every one of them (guardrail 1). */
  private grantable(permissions: readonly string[]): Permission[] {
    const unknown = permissions.filter((p) => !isPermission(p));
    if (unknown.length) throw new GuardrailError(`Unknown permission(s): ${unknown.join(", ")}.`);
    const missing = permissions.filter((p) => !can(this.caller, p as Permission));
    if (missing.length) throw new GuardrailError(`You can't grant permissions you don't have yourself: ${missing.join(", ")}.`);
    return [...new Set(permissions as Permission[])];
  }
}

/** Gives a new organization its built-in Owner, Admin and Member roles (safe to repeat). */
export function seedDefaultRoles(roles: RoleRepository): Promise<void> {
  return roles.seedDefaults(DEFAULT_ROLES);
}
