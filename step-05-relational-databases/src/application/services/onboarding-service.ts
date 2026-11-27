import type { NewUser } from "../../domain/entities/tenant";
import type { IdentityProvider } from "../../domain/ports/auth/identity-provider";
import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";
import type { TenantRepository } from "../../domain/ports/persistence/tenant-repository";

// What happens when someone signs up: they get their own tenant (a customer
// account) and a personal organization in it with them as Owner. (Creating
// the organization seeds its default roles, as for every organization.)
// After this, the very first token they get already names an organization
// they belong to.
//
// Safe to run twice: a user who already owns a tenant is left alone, and an
// organization they already belong to is reused rather than duplicated (so a
// retry after a half-finished onboarding completes it).

export interface OnboardingResult {
  tenantId: string;
  organizationId: string;
}

export interface OnboardingOptions {
  now?: () => Date;
  newId?: () => string;
}

export class OnboardingService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly identity: IdentityProvider,
    private readonly memberships: MembershipReader,
    private readonly tenants: TenantRepository,
    options: OnboardingOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Sets up a new user's tenant and organization; returns null if they were already set up. */
  async onboard(user: NewUser): Promise<OnboardingResult | null> {
    if (await this.tenants.tenantOwnedBy(user.id)) return null;

    const displayName = user.name.trim() || user.email.split("@")[0] || "My";
    const existing = await this.memberships.organizationsOf(user.id);
    const organizationId =
      existing[0] ??
      (await this.identity.createOrganization({
        ownerUserId: user.id,
        name: `${displayName}'s company`.slice(0, 100),
        slug: `${slugify(displayName)}-${this.newId().slice(0, 8)}`,
      }));

    const tenantId = this.newId();
    await this.tenants.createTenantForOrganization({
      tenantId,
      tenantName: `${displayName}'s account`.slice(0, 100),
      ownerUserId: user.id,
      organizationId,
      now: this.now().toISOString(),
    });
    return { tenantId, organizationId };
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company"
  );
}
