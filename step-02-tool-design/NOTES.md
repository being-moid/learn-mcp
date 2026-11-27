# Step 02 notes: Designing good tools

**Live MCP URL:** https://learn-mcp-step-02.stockroom-mms.workers.dev/mcp

A notes toolset for Stockroom's sales reps, stored in Cloudflare Workers KV, with no auth yet.

## What I built and why

list notes returns the list of saved notes of a user
get note searches the note
Create notes creates a note

I added defineTool function in the codebase in order to make reuseablity and encapsulating and implying strict rules to create a tool to have all best options required so that when agent's write tool it always uses that function and remembers what needs be supplied in order to make a tool correct

What i noticed was using mcp saving notes as datasource were shared among user sessions which should be fixed via implementing auth and user management

## Tools

| Tool | Does | Hints |
| --- | --- | --- |
| `list_notes` | Lists note summaries (ID, title, category, date), paginated with `limit` and `cursor` | read-only, idempotent |
| `get_note` | Reads one note in full by its ID | read-only, idempotent |
| `create_note` | Saves a new note with a title, body and category (`call`, `meeting`, `follow_up`, `other`) | write |
| `delete_note` | Permanently deletes one note by its ID | **destructive** |

Every tool returns structured content plus a short text summary. Errors are recoverable `isError` results that say what to do next.

## Files

- `src/tool-kit.ts`: `defineTool`, which requires a title, description, input and output schemas and the safety hints; copies the title into the annotations; and turns unexpected errors into recoverable results.
- `src/tools.ts`: the four tools, exported as the `tools` array that `registerTools` loops over.
- `src/notes.ts`: KV storage. Notes are keyed `note:<id>`, with a summary kept in KV metadata so listing doesn't read every note.
- `src/bad-tool.ts` and `TOOL-DESIGN.md`: a deliberately bad `remove` tool (never registered) and a comparison with `delete_note`.

## Run, test and deploy

From this folder, using Node.js 24 or later:

```bash
npm install
npm run dev         # http://localhost:8787/mcp, with a local KV
npm run typecheck   # wrangler types && tsc
npm test            # 10 tests in the Workers runtime, using a local KV
```

The KV namespace was created once with `npx wrangler kv namespace create NOTES` and is bound as `NOTES` in `wrangler.jsonc`. To deploy:

```bash
npm run deploy      # Worker learn-mcp-step-02, separate from step 01
```

Clients connect to the live URL above as a **new** connector ("Stockroom Step 02"), separate from Step 01's.
