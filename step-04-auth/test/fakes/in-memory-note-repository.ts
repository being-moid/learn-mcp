import type { Note, NotePage } from "../../src/domain/entities/note";
import type { NoteRepository } from "../../src/domain/ports/persistence/note-repository";

/**
 * An in-memory NoteRepository for unit tests. Any implementation of the port
 * must behave the same way, which is what lets services be tested without KV.
 */
export class InMemoryNoteRepository implements NoteRepository {
  readonly notes = new Map<string, Note>();

  async save(note: Note): Promise<void> {
    this.notes.set(note.id, note);
  }

  async get(id: string): Promise<Note | null> {
    return this.notes.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    return this.notes.delete(id);
  }

  async list(limit: number, cursor?: string): Promise<NotePage> {
    // The cursor is simply the index to start from.
    const all = [...this.notes.values()];
    const start = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid cursor: ${cursor}`);
    const page = all.slice(start, start + limit).map(({ body, ...summary }) => summary);
    const next = start + limit;
    return { notes: page, nextCursor: next < all.length ? String(next) : null };
  }
}
