import type { NewNote, Note, NotePage } from "../../domain/entities/note";
import type { ChangeNotifier } from "../../domain/ports/notifications/change-notifier";
import type { NoteRepository } from "../../domain/ports/persistence/note-repository";

// The notes use cases. They depend only on ports, so the same rules run
// against KV in production and against in-memory fakes in unit tests.
//
// Scoping (whose notes these are) is decided by the repository the
// composition root passes in (from the RepositoryFactory, for the caller's
// Principal), not here: a service can't forget it.

export interface NotesServiceOptions {
  /** Current time, injectable so tests can be exact. */
  now?: () => Date;
  /** New note IDs, injectable so tests can be exact. */
  newId?: () => string;
}

export class NotesService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly notes: NoteRepository,
    private readonly changes: ChangeNotifier,
    options: NotesServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  list(limit: number, cursor?: string): Promise<NotePage> {
    return this.notes.list(limit, cursor);
  }

  get(id: string): Promise<Note | null> {
    return this.notes.get(id);
  }

  async create(input: NewNote): Promise<Note> {
    const note: Note = { id: this.newId(), createdAt: this.now().toISOString(), ...input };
    await this.notes.save(note);
    // Rule: a new note changes the set of note:// resources, so clients
    // listening for changes are told to re-list.
    this.changes.resourcesChanged();
    return note;
  }

  /** Returns false if there was no such note (and then announces nothing). */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.notes.delete(id);
    if (deleted) this.changes.resourcesChanged();
    return deleted;
  }
}
