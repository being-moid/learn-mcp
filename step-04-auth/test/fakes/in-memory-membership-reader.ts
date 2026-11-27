import type { MemberSummary, Membership } from "../../src/domain/entities/membership";
import type { MembershipReader } from "../../src/domain/ports/persistence/membership-reader";

/** An in-memory MembershipReader for unit tests. */
export class InMemoryMembershipReader implements MembershipReader {
  readonly memberships: Membership[] = [];

  async find(userId: string, organizationId: string): Promise<Membership | null> {
    return this.memberships.find((m) => m.userId === userId && m.organizationId === organizationId) ?? null;
  }

  async organizationsOf(userId: string): Promise<string[]> {
    return this.memberships.filter((m) => m.userId === userId).map((m) => m.organizationId);
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    return this.memberships
      .filter((m) => m.organizationId === organizationId)
      .map((m) => ({ userId: m.userId, name: m.userId, email: `${m.userId}@example.com`, role: m.role }));
  }

  async organizationName(organizationId: string): Promise<string | null> {
    return this.memberships.some((m) => m.organizationId === organizationId) ? `Organization ${organizationId}` : null;
  }
}
