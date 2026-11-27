// The identity system's own records: users, organizations and memberships.
// The auth library (Better Auth today) owns these writes, so services create
// organizations through this port rather than writing its tables. (Reading
// memberships is MembershipReader's job.)

export interface IdentityProvider {
  /** Creates an organization with `ownerUserId` as its owner member; returns its ID. */
  createOrganization(input: { ownerUserId: string; name: string; slug: string }): Promise<string>;
}
