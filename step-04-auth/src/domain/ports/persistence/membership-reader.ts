import type { MemberSummary, Membership } from "../../entities/membership";

/** Reads whether a user currently belongs to an organization. */
export interface MembershipReader {
  /** The membership, or null if the user isn't (or is no longer) a member. */
  find(userId: string, organizationId: string): Promise<Membership | null>;

  /** IDs of every organization the user currently belongs to, oldest membership first. */
  organizationsOf(userId: string): Promise<string[]>;

  /** Every member of the organization, with their role. */
  listMembers(organizationId: string): Promise<MemberSummary[]>;

  /** The organization's display name, or null if it doesn't exist. */
  organizationName(organizationId: string): Promise<string | null>;
}
