import type { Role } from "../../entities/role";
import type { Permission } from "../../permissions";

/**
 * The roles of ONE organization (an instance is built for a single
 * organization, so it can't reach another's roles), and who has which.
 */
export interface RoleRepository {
  list(): Promise<Role[]>;
  get(roleId: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;

  /** Creates the built-in Owner, Admin and Member roles if they don't exist yet. */
  seedDefaults(roles: ReadonlyArray<{ builtin: "owner" | "admin" | "member"; name: string; permissions: readonly Permission[] }>): Promise<void>;

  create(input: { name: string; permissions: readonly Permission[] }): Promise<Role>;
  /** Replaces a role's permissions (all at once, in one transaction). */
  setPermissions(roleId: string, permissions: readonly Permission[]): Promise<void>;

  /** The role a member of this organization has now, or null if they aren't a member. */
  roleOf(userId: string): Promise<Role | null>;
  /** Gives a member a role (replacing their previous one), in one transaction. */
  assign(userId: string, role: Role): Promise<void>;
  /** How many members currently have the built-in Owner role. */
  countOwners(): Promise<number>;
  /** Removes a member from this organization (membership and role assignment), in one transaction. */
  removeMember(userId: string): Promise<void>;
}
