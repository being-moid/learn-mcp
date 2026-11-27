import { describe, expect, it } from "vitest";
import type { Note } from "../../src/domain/entities/note";
import type { NoteRepository } from "../../src/domain/ports/persistence/note-repository";

/**
 * The behaviour every NoteRepository must have, whatever stores the notes.
 * Each implementation runs this same suite (the in-memory fake in a unit
 * test, KV in an integration test, a database later), which is what makes
 * swapping implementations safe.
 *
 * `fresh` must return an empty repository each time.
 */
export function noteRepositoryContract(name: string, fresh: () => NoteRepository): void {
  const note = (id: string, title = `Note ${id}`): Note => ({
    id,
    title,
    body: `Body of ${id}`,
    category: "other",
    createdAt: "2026-11-27T10:00:00.000Z",
  });

  describe(`NoteRepository contract: ${name}`, () => {
    it("returns a saved note in full", async () => {
      const repo = fresh();
      await repo.save(note("a"));
      expect(await repo.get("a")).toEqual(note("a"));
    });

    it("returns null for a note that doesn't exist", async () => {
      expect(await fresh().get("missing")).toBeNull();
    });

    it("lists summaries without bodies", async () => {
      const repo = fresh();
      await repo.save(note("a"));
      const page = await repo.list(10);
      expect(page.notes).toEqual([{ id: "a", title: "Note a", category: "other", createdAt: "2026-11-27T10:00:00.000Z" }]);
      expect(page.nextCursor).toBeNull();
    });

    it("pages with a cursor until every note has been seen once", async () => {
      const repo = fresh();
      for (const id of ["a", "b", "c"]) await repo.save(note(id));
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repo.list(2, cursor);
        seen.push(...page.notes.map((n) => n.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen.sort()).toEqual(["a", "b", "c"]);
    });

    it("deletes a note and reports whether there was one", async () => {
      const repo = fresh();
      await repo.save(note("a"));
      expect(await repo.delete("a")).toBe(true);
      expect(await repo.get("a")).toBeNull();
      expect(await repo.delete("a")).toBe(false);
    });
  });
}
