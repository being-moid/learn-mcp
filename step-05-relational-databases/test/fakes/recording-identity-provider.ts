import type { IdentityProvider } from "../../src/domain/ports/auth/identity-provider";
import type { InMemoryMembershipReader } from "./in-memory-membership-reader";
import { membership } from "./memberships";

/** An IdentityProvider for unit tests: "creates" organizations by adding an owner membership. */
export class RecordingIdentityProvider implements IdentityProvider {
  readonly created: Array<{ ownerUserId: string; name: string; slug: string; id: string }> = [];

  constructor(private readonly memberships: InMemoryMembershipReader) {}

  async createOrganization(input: { ownerUserId: string; name: string; slug: string }): Promise<string> {
    const id = `org-${this.created.length + 1}`;
    this.created.push({ ...input, id });
    this.memberships.memberships.push(membership(input.ownerUserId, id, "owner"));
    return id;
  }
}
