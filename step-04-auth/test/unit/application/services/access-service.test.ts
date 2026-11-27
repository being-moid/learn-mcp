import { describe, expect, it } from "vitest";
import { AccessService } from "../../../../src/application/services/access-service";
import { ANONYMOUS } from "../../../../src/domain/entities/principal";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";

describe("AccessService", () => {
  const memberships = new InMemoryMembershipReader();
  memberships.memberships.push(membership("u1", "o1", "owner"));
  const access = new AccessService(memberships);

  it("allows a current member and returns their membership", async () => {
    expect(await access.check({ kind: "user", userId: "u1", organizationId: "o1" })).toEqual({
      allowed: true,
      membership: membership("u1", "o1", "owner"),
    });
  });

  it("refuses a user who isn't a member of the organization in their token", async () => {
    expect(await access.check({ kind: "user", userId: "u1", organizationId: "o2" })).toEqual({ allowed: false, reason: "not_a_member" });
    expect(await access.check({ kind: "user", userId: "u2", organizationId: "o1" })).toEqual({ allowed: false, reason: "not_a_member" });
  });

  it("refuses an anonymous caller", async () => {
    expect(await access.check(ANONYMOUS)).toEqual({ allowed: false, reason: "not_signed_in" });
  });
});
