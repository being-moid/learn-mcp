import type { Note, NotePage } from "../../entities/note";

/**
 * Stores notes. An instance is already scoped to one caller (it is handed
 * out by a RepositoryFactory for a Principal), so no method can reach another
 * user's or another organization's notes.
 */
export interface NoteRepository {
  save(note: Note): Promise<void>;
  get(id: string): Promise<Note | null>;
  /** Deletes a note; returns false if there was nothing to delete. */
  delete(id: string): Promise<boolean>;
  /** One page of notes, in no particular order. Throws if `cursor` is invalid. */
  list(limit: number, cursor?: string): Promise<NotePage>;
}
