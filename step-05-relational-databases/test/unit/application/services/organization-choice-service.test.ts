import { describe, expect, it } from "vitest";
import { OrganizationChoiceService } from "../../../../src/application/services/organization-choice-service";
import { InMemoryMembershipReader } from "../../../fakes/in-memory-membership-reader";
import { membership } from "../../../fakes/memberships";

describe("OrganizationChoiceService", () => {
  const memberships = new InMemoryMembershipReader();
  memberships.memberships.push(
    membership("one", "a", "owner"),
    membership("two", "b", "owner"),
    membership("two", "c", "member"),
  );
  const choice = new OrganizationChoiceService(memberships);

  it("defaults to the user's first organization, or none", async () => {
    expect(await choice.defaultOrganizationFor("one")).toBe("a");
    expect(await choice.defaultOrganizationFor("two")).toBe("b");
    expect(await choice.defaultOrganizationFor("nobody")).toBeNull();
  });

  it("asks only users with several organizations to choose", async () => {
    expect(await choice.mustChoose("one")).toBe(false);
    expect(await choice.mustChoose("two")).toBe(true);
  });
});
