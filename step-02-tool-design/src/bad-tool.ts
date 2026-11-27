import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteNote } from "./notes";

// ⚠️ A DELIBERATELY BAD version of delete_note, kept only for comparison
// (see TOOL-DESIGN.md). It is never registered: registerTools() in tools.ts
// doesn't call this, so it is not part of the deployed server.
//
// Everything wrong with it is on purpose:
//   - a vague name that could mean anything
//   - no title, no description
//   - a loose schema: one untyped field with a meaningless name
//   - no annotations, so hosts can't tell it destroys data
//   - it throws on a missing note and answers "ok" on success
export function registerBadDeleteTool(server: McpServer): void {
  server.registerTool(
    "remove",
    {
      // z.any() on purpose: accepting anything is the point of this example.
      inputSchema: z.object({ x: z.any() }),
    },
    async ({ x }) => {
      const deleted = await deleteNote(String(x));
      if (!deleted) throw new Error("not found");
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
}
