import type { Membership } from "../../domain/entities/membership";
import type { Principal } from "../../domain/entities/principal";
import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";

// Decides whether an authenticated caller may use the server right now.
//
// The access token says who the caller is and which organization they chose
// when they connected. It can stay valid for up to an hour, so it can't be
// trusted to say they still belong there: this service asks the database on
// every request. A removed member is refused on their very next call.

export type AccessDecision =
  | { allowed: true; membership: Membership }
  | { allowed: false; reason: "not_signed_in" | "not_a_member" };

export class AccessService {
  constructor(private readonly memberships: MembershipReader) {}

  async check(principal: Principal): Promise<AccessDecision> {
    if (principal.kind !== "user") return { allowed: false, reason: "not_signed_in" };
    const membership = await this.memberships.find(principal.userId, principal.organizationId);
    if (!membership) return { allowed: false, reason: "not_a_member" };
    return { allowed: true, membership };
  }
}
