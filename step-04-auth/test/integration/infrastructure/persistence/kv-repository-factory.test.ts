import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Note } from "../../../../src/domain/entities/note";
import { ANONYMOUS, type Principal } from "../../../../src/domain/entities/principal";
import { KvNoteRepository } from "../../../../src/infrastructure/persistence/kv/kv-note-repository";
import { KvRepositoryFactory, notePrefix } from "../../../../src/infrastructure/persistence/kv/kv-repository-factory";
import { noteRepositoryContract } from "../../../contracts/note-repository.contract";

// KvNoteRepository passes the same contract as the in-memory fake. Each run
// uses a fresh, unique prefix so tests don't see each other's notes.
noteRepositoryContract("Workers KV", () => new KvNoteRepository(env.NOTES, `contract:${crypto.randomUUID()}:note:`));

const note = (id: string): Note => ({ id, title: id, body: "x", category: "other", createdAt: "2026-11-27T10:00:00.000Z" });

describe("KvRepositoryFactory", () => {
  const alice: Principal = { kind: "user", userId: "alice", organizationId: "org-1" };
  const bob: Principal = { kind: "user", userId: "bob", organizationId: "org-1" };
  const aliceElsewhere: Principal = { kind: "user", userId: "alice", organizationId: "org-2" };

  it("keeps anonymous callers on today's keys", () => {
    expect(notePrefix(ANONYMOUS)).toBe("note:");
  });

  it("scopes a signed-in caller's notes to their organization and user", () => {
    expect(notePrefix(alice)).toBe("org:org-1:user:alice:note:");
  });

  it("never shows one user's notes to another user, or to the same user in another organization", async () => {
    const factory = new KvRepositoryFactory(env.NOTES);
    const id = crypto.randomUUID();
    await factory.notes(alice).save(note(id));

    expect(await factory.notes(alice).get(id)).not.toBeNull();
    for (const other of [bob, aliceElsewhere, ANONYMOUS]) {
      const repo = factory.notes(other);
      expect(await repo.get(id)).toBeNull();
      expect((await repo.list(50)).notes.map((n) => n.id)).not.toContain(id);
      expect(await repo.delete(id)).toBe(false);
    }
    // And the failed deletes above didn't touch Alice's note.
    expect(await factory.notes(alice).get(id)).not.toBeNull();
  });
});
