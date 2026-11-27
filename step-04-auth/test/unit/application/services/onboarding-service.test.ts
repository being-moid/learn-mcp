import { beforeEach, describe, expect, it } from "vitest";
import { OnboardingService } from "../../../../src/application/services/onboarding-service";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";
import { InMemoryTenantRepository } from "../../../fakes/in-memory-tenant-repository";
import { RecordingIdentityProvider } from "../../../fakes/recording-identity-provider";

describe("OnboardingService", () => {
  let memberships: InMemoryMembershipReader;
  let identity: RecordingIdentityProvider;
  let tenants: InMemoryTenantRepository;
  let onboarding: OnboardingService;
  const ayesha = { id: "u1", name: "Ayesha Khan", email: "ayesha@example.com" };

  beforeEach(() => {
    memberships = new InMemoryMembershipReader();
    identity = new RecordingIdentityProvider(memberships);
    tenants = new InMemoryTenantRepository();
    let n = 0;
    onboarding = new OnboardingService(identity, memberships, tenants, { newId: () => `id-${++n}`, now: () => new Date("2026-11-27T00:00:00Z") });
  });

  it("gives a new user a personal organization they own and a tenant around it", async () => {
    const result = await onboarding.onboard(ayesha);
    expect(identity.created).toEqual([{ ownerUserId: "u1", name: "Ayesha Khan's company", slug: "ayesha-khan-id-1", id: "org-1" }]);
    expect(result).toEqual({ tenantId: "id-2", organizationId: "org-1" });
    expect(tenants.tenants[0]).toMatchObject({ tenantId: "id-2", tenantName: "Ayesha Khan's account", ownerUserId: "u1", organizationId: "org-1" });
  });

  it("is safe to run twice: a user who already owns a tenant is left alone", async () => {
    await onboarding.onboard(ayesha);
    expect(await onboarding.onboard(ayesha)).toBeNull();
    expect(identity.created).toHaveLength(1);
    expect(tenants.tenants).toHaveLength(1);
  });

  it("finishes a half-done onboarding by reusing the organization instead of creating another", async () => {
    memberships.memberships.push(membership("u1", "existing-org", "owner"));
    const result = await onboarding.onboard(ayesha);
    expect(identity.created).toHaveLength(0);
    expect(result?.organizationId).toBe("existing-org");
  });

  it("names things sensibly when the user gave no name", async () => {
    await onboarding.onboard({ id: "u2", name: "  ", email: "sara@example.com" });
    expect(identity.created[0].name).toBe("sara's company");
  });
});
