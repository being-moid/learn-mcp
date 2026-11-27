import { ResourceNotFoundError, ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getNote, listNotes } from "./notes";

// Each note is also a resource at note://{id}. Tools are picked by the model;
// resources are picked by the person or the app (for example from Claude's
// attach menu), so a rep can put a specific note into the chat on purpose.
// Both read the same notes from KV through notes.ts.

// How many notes resources/list offers. The attach menu is for picking, not
// paging through hundreds; list_notes (the tool) pages through everything.
const LIST_LIMIT = 100;

// Notes become per-user in step 4, and a shared cache must never hand one
// person's notes to another, so results are only cacheable by the requesting
// client ("private"), and only briefly, because notes change.
const CACHE = { cacheScope: "private" as const, ttlMs: 30_000 };

const noteUri = (id: string) => `note://${id}`;

export function registerResources(server: McpServer): void {
  server.registerResource(
    "note",
    new ResourceTemplate("note://{id}", {
      // resources/list: every note, so clients can show them in a picker.
      list: async () => {
        const { notes } = await listNotes(LIST_LIMIT);
        return {
          resources: notes.map((n) => ({
            uri: noteUri(n.id),
            name: n.id,
            title: n.title,
            description: `${n.category} note, created ${n.createdAt}`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Sales note",
      description: "One saved sales note, as markdown: its title, category, date and full text.",
      mimeType: "text/markdown",
      cacheHint: CACHE,
    },
    // resources/read: the note's text. {id} comes from the URI, so it is
    // validated like any other input before it reaches KV.
    async (uri, { id }) => {
      const parsed = z.uuid().safeParse(id);
      // The spec requires a JSON-RPC error (-32602) for a missing resource,
      // never an empty result. ResourceNotFoundError produces exactly that.
      if (!parsed.success) throw new ResourceNotFoundError(uri.href, `Not a note URI: ${uri.href}. Expected note://<note ID>.`);
      const note = await getNote(parsed.data);
      if (!note) throw new ResourceNotFoundError(uri.href, `No note at ${uri.href}. It may have been deleted.`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# ${note.title}\n\nCategory: ${note.category} · Created: ${note.createdAt}\n\n${note.body}`,
          },
        ],
      };
    },
  );
}
