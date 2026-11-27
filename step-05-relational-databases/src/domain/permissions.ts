// What the software can do, as a fixed list. Organizations name their own
// roles, but a role can only be made of these permissions: an organization
// can't invent a new one. Every tool, resource and prompt declares which
// permission it needs (stage 5).

export const PERMISSIONS = [
  // Reading the company's business data in Neon (sales, from step 05). The
  // notes permissions of steps 2 to 4 went with the notes.
  "sales:read",
  "members:read",
  "members:invite",
  "members:remove",
  "roles:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export type BuiltinRole = "owner" | "admin" | "member";

/** The roles every new organization starts with. Organizations can rename them and add their own. */
export const DEFAULT_ROLES: ReadonlyArray<{ builtin: BuiltinRole; name: string; permissions: readonly Permission[] }> = [
  { builtin: "owner", name: "Owner", permissions: PERMISSIONS },
  { builtin: "admin", name: "Admin", permissions: PERMISSIONS },
  { builtin: "member", name: "Member", permissions: ["sales:read"] },
];
