import type { MembershipReader } from "../../domain/ports/persistence/membership-reader";

// Which organization a connection acts for. A user with one organization
// uses it; a user who belongs to several picks one when they connect.
export class OrganizationChoiceService {
  constructor(private readonly memberships: MembershipReader) {}

  /** The organization a new session should act for: the user's first one, or null if they have none. */
  async defaultOrganizationFor(userId: string): Promise<string | null> {
    return (await this.memberships.organizationsOf(userId))[0] ?? null;
  }

  /** Whether the user belongs to more than one organization and must pick one. */
  async mustChoose(userId: string): Promise<boolean> {
    return (await this.memberships.organizationsOf(userId)).length > 1;
  }
}
