/** Tenants, their admins, and the link from organizations to tenants. */
export interface TenantRepository {
  /** The tenant a user owns, if they have one (used to keep onboarding idempotent). */
  tenantOwnedBy(userId: string): Promise<string | null>;

  /**
   * Sets up a new tenant around an existing organization, in one transaction:
   * creates the tenant, makes `ownerUserId` its owner and links the
   * organization to it. Either all of it happens or none of it does. (The
   * organization's roles are seeded when it is created, for every organization.)
   */
  createTenantForOrganization(input: {
    tenantId: string;
    tenantName: string;
    ownerUserId: string;
    organizationId: string;
    now: string;
  }): Promise<void>;
}
