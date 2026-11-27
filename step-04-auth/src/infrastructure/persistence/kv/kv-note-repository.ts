import type { Note, NotePage, NoteSummary } from "../../../domain/entities/note";
import type { NoteRepository } from "../../../domain/ports/persistence/note-repository";

// Notes stored in Workers KV, never in the Worker's memory. Cloudflare can
// run many copies of this Worker and recycle any of them at any time, so a
// note kept in memory would be missing whenever a different copy answers.
//
// The namespace and the key prefix are passed in by KvRepositoryFactory, so
// this class never decides whose notes it is reading.
export class KvNoteRepository implements NoteRepository {
  constructor(
    private readonly kv: KVNamespace,
    private readonly prefix = "note:",
  ) {}

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async save(note: Note): Promise<void> {
    // The summary also goes in KV metadata, so list() can show titles without
    // reading every note. Metadata is limited to 1,024 bytes, which is why
    // titles are capped at 120 characters.
    const { body, ...summary } = note;
    await this.kv.put(this.key(note.id), JSON.stringify(note), { metadata: summary });
  }

  async get(id: string): Promise<Note | null> {
    return this.kv.get<Note>(this.key(id), "json");
  }

  async delete(id: string): Promise<boolean> {
    // KV delete succeeds even for a missing key, so check first to report it.
    if ((await this.kv.get(this.key(id))) === null) return false;
    await this.kv.delete(this.key(id));
    return true;
  }

  async list(limit: number, cursor?: string): Promise<NotePage> {
    const page = await this.kv.list<NoteSummary>({ prefix: this.prefix, limit, cursor });
    return {
      notes: page.keys.flatMap((k) => (k.metadata ? [k.metadata] : [])),
      nextCursor: page.list_complete ? null : page.cursor,
    };
  }
}
