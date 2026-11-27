import type { Permission } from "../permissions";

/** A role an organization defines: a name it chose and the permissions it grants. */
export interface Role {
  id: string;
  organizationId: string;
  name: string;
  /** 'owner', 'admin' or 'member' for a built-in role (renamable, not removable); null for a custom one. */
  builtin: "owner" | "admin" | "member" | null;
  permissions: readonly Permission[];
}
