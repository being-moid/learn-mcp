import type { Role } from "../../src/domain/entities/role";
import type { Permission } from "../../src/domain/permissions";
import type { RoleRepository } from "../../src/domain/ports/persistence/role-repository";

/** An in-memory RoleRepository for one organization, for unit tests. */
export class InMemoryRoleRepository implements RoleRepository {
  readonly roles: Role[] = [];
  /** userId -> roleId */
  readonly assignments = new Map<string, string>();
  private next = 0;

  constructor(readonly organizationId = "org-1") {}

  async list(): Promise<Role[]> { return [...this.roles]; }
  async get(roleId: string): Promise<Role | null> { return this.roles.find((r) => r.id === roleId) ?? null; }
  async findByName(name: string): Promise<Role | null> { return this.roles.find((r) => r.name === name) ?? null; }

  async seedDefaults(defaults: ReadonlyArray<{ builtin: "owner" | "admin" | "member"; name: string; permissions: readonly Permission[] }>): Promise<void> {
    if (this.roles.some((r) => r.builtin)) return;
    for (const d of defaults) this.roles.push({ id: `role-${d.builtin}`, organizationId: this.organizationId, name: d.name, builtin: d.builtin, permissions: [...d.permissions] });
  }

  async create({ name, permissions }: { name: string; permissions: readonly Permission[] }): Promise<Role> {
    const role: Role = { id: `role-${++this.next}`, organizationId: this.organizationId, name, builtin: null, permissions: [...permissions] };
    this.roles.push(role);
    return role;
  }

  async setPermissions(roleId: string, permissions: readonly Permission[]): Promise<void> {
    const role = this.roles.find((r) => r.id === roleId);
    if (role) Object.assign(role, { permissions: [...permissions] });
  }

  async roleOf(userId: string): Promise<Role | null> {
    const roleId = this.assignments.get(userId);
    return roleId ? (await this.get(roleId)) : null;
  }

  async assign(userId: string, role: Role): Promise<void> { this.assignments.set(userId, role.id); }

  async countOwners(): Promise<number> {
    return [...this.assignments.values()].filter((id) => this.roles.find((r) => r.id === id)?.builtin === "owner").length;
  }
}
