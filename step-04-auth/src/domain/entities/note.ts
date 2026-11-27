// The note entity. Plain types only: the domain layer knows nothing about
// KV, D1, MCP or Cloudflare.

export const CATEGORIES = ["call", "meeting", "follow_up", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Note {
  id: string;
  title: string;
  body: string;
  category: Category;
  createdAt: string;
}

/** A note without its body: what a list shows. */
export type NoteSummary = Omit<Note, "body">;

/** One page of a note list. `nextCursor` is null on the last page. */
export interface NotePage {
  notes: NoteSummary[];
  nextCursor: string | null;
}

/** What a caller supplies to create a note; the service adds the id and date. */
export interface NewNote {
  title: string;
  body: string;
  category: Category;
}
