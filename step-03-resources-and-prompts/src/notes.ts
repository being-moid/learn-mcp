import { env } from "cloudflare:workers";

// Notes are stored in Workers KV, never in the Worker's memory. Cloudflare can
// run many copies of this Worker and recycle any of them at any time, so a
// note kept in a module-level variable would be missing from the next call
// whenever a different copy answers it, and would vanish on restart.
//
// `env` from "cloudflare:workers" gives us the bindings (here the NOTES
// namespace). It is configuration, not request data, so reading it per call is
// stateless.

export const CATEGORIES = ["call", "meeting", "follow_up", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Note {
  id: string;
  title: string;
  body: string;
  category: Category;
  createdAt: string;
}

// The small part of a note kept in KV metadata, so list_notes can show
// titles without reading every note. KV metadata is limited to 1,024 bytes,
// which is why titles are capped at 120 characters.
export type NoteSummary = Omit<Note, "body">;

const PREFIX = "note:";
const key = (id: string) => `${PREFIX}${id}`;

export async function createNote(input: { title: string; body: string; category: Category }): Promise<Note> {
  const note: Note = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
  const { body, ...summary } = note;
  await env.NOTES.put(key(note.id), JSON.stringify(note), { metadata: summary });
  return note;
}

export async function getNote(id: string): Promise<Note | null> {
  return env.NOTES.get<Note>(key(id), "json");
}

export async function deleteNote(id: string): Promise<boolean> {
  // KV delete succeeds even for a missing key, so check first to report it.
  if ((await env.NOTES.get(key(id))) === null) return false;
  await env.NOTES.delete(key(id));
  return true;
}

export async function listNotes(limit: number, cursor?: string): Promise<{ notes: NoteSummary[]; nextCursor: string | null }> {
  const page = await env.NOTES.list<NoteSummary>({ prefix: PREFIX, limit, cursor });
  return {
    notes: page.keys.flatMap((k) => (k.metadata ? [k.metadata] : [])),
    nextCursor: page.list_complete ? null : page.cursor,
  };
}
