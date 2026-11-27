import type { IdentityProvider } from "../../domain/ports/auth/identity-provider";

/** The part of Better Auth's server API this adapter uses. */
export interface OrganizationApi {
  createOrganization(input: { body: { name: string; slug: string; userId: string } }): Promise<{ id: string } | null>;
}

// IdentityProvider on Better Auth: organizations are created through Better
// Auth's own API, so its rules hold (the creator becomes the "owner" member).
export class BetterAuthIdentityProvider implements IdentityProvider {
  constructor(private readonly api: OrganizationApi) {}

  async createOrganization({ ownerUserId, name, slug }: { ownerUserId: string; name: string; slug: string }): Promise<string> {
    const organization = await this.api.createOrganization({ body: { name, slug, userId: ownerUserId } });
    if (!organization?.id) throw new Error("Better Auth did not create the organization");
    return organization.id;
  }
}
