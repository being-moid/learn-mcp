# Step 03 notes: Resources and prompts

**Live MCP URL:** https://learn-mcp-step-03.stockroom-mms.workers.dev/mcp

The step 2 notes server, now also offering each note as a resource (`note://{id}`) and one prompt (`summarize_notes`). The four notes tools are unchanged.

## What I built and why

- A tool is what the AI decides to run; a resource is data at an address that I pick and attach. For notes they overlap, but widgets and skills later are resources, so this was practice.
- Notifications broke because Workers won't let one request write to another request's stream. I put a Durable Object in the middle that owns the streams, and switched to the SDK handler because Cloudflare's wrapper hides the bus option.
- Neither Claude nor ChatGPT showed resources or prompts, so I used the Inspector. ChatGPT said 5 notes when the server returned 3, and filled in details from the chat.

## What each client showed

Checked on 27 November 2026 against the live server, with a log of each request's `Mcp-Method` header (`npx wrangler tail learn-mcp-step-03 --format json`).

- **ChatGPT** (`chatgpt.png`): no MCP prompt was offered, so I typed "Summarize my Stockroom notes, follow-ups first." ChatGPT called `list_notes` only, never `prompts/get` or `get_note`. `list_notes` returned 3 notes, but ChatGPT reported "5 Stockroom notes" and added details (a 10% discount, a Wednesday deadline) that came from earlier messages in the chat, not from the server. That is the guessing the prompt's instructions ("call get_note for each note… say so instead of guessing") are written to prevent.
- **Claude:** the **+** menu for the Stockroom Step 03 connector offered no notes to attach and no "Summarize my notes" prompt, so this Claude surface doesn't show MCP resources or prompts yet; it only uses the tools. Asking for a summary in my own words produced `server/discover` and `tools/call list_notes` (`claude.png`), but no `prompts/get` or `resources/read`. Quoting an earlier chat message and asking for an email worked, but that is Claude's quote-reply, not a resource: the server received no `resources/read`.
- **MCP Inspector:** used to show the resources and the prompt working, since neither client shows them (`inspector-resources.png`, `inspector-prompt-args.png`, `inspector-prompt.png`, and `inspector-messages.png` for the connection).
- **Notifications:** a connected client opened a real `subscriptions/listen` stream on the live server, which stayed open.

## Why MCP prompts are rarely used today, and how skills differ

An MCP prompt is a ready-made starting message that a **person** picks, usually from a slash menu. `summarize_notes` is one: choosing it puts a "please summarize my notes, here's how" message into the chat, and the model then does the work with `list_notes` and `get_note`.

Prompts are still in the MCP spec and not deprecated, but few servers ship them, for three reasons:

1. **Someone has to know to pick them.** A prompt only runs if the user finds it in a menu and chooses it. Most people just type what they want ("summarize this week's notes"), and the prompt never gets used.
2. **Clients show them differently, or not at all.** Each app decides whether and where to surface MCP prompts: a slash menu, an attach menu, or nowhere. So the same server feels different in each client, and a prompt can be invisible in some.
3. **They're all or nothing.** A prompt drops its full text into the conversation at the start. It can't load extra detail only when a task needs it.

A **skill served over MCP** (step 10) covers the same need, reusable know-how, the other way round:

| | MCP prompt (`summarize_notes`) | Skill over MCP (step 10) |
| --- | --- | --- |
| **Who picks it** | The person, from a menu | The **model**, when the task matches the skill's short description |
| **When it loads** | All at once, when the person picks it | In stages: only the name and description at first; the full instructions (and any files) only when the model decides it needs them |
| **How it travels** | `prompts/get` | As `skill://` resources, read with `resources/read` |
| **Across clients** | Depends on each client's prompt UI | Works wherever the client supports the skills extension, without the user finding a menu |

So a skill helps even when the user never knows it exists, and it costs little context until it is needed. That's why the bootcamp keeps prompts to this one step and teaches skills for reusable procedures. Client support for skills is still rolling out (Claude has it in public beta), so step 10 also keeps a plain-tool fallback.

## Tool, resource or prompt? A review of the whole server

The test for each feature is **who should decide that it happens**: the model (tool), the person or app choosing context (resource), or the person starting a task (prompt).

| Feature | Is a | Why | Keep, or move? |
| --- | --- | --- | --- |
| `create_note` | Tool | It changes data. Resources are read-only and prompts only build messages, so anything with a side effect must be a tool. | Keep |
| `delete_note` | Tool | It destroys data, and its `destructiveHint` makes the host ask the user first. Only tools carry those hints. | Keep |
| `list_notes` | Tool | The model needs it mid-task (to find an ID, or to summarise), with arguments it chooses: `limit` and `cursor` for paging. | Keep |
| `get_note` | Tool | The model reads a note when a task needs it, such as "what did Ali want?". | Keep, even though `note://{id}` returns the same note (see below) |
| `note://{id}` | Resource (template) | A rep attaches a specific note on purpose, so the person controls what context the model gets. It is read-only and has a stable address, which is exactly what resources are for. | Keep |
| `summarize_notes` | Prompt | A repeatable task a person starts from a menu, with one optional argument. It only builds a message; the model does the work with the tools. | Keep for this step; **move to a skill in step 10** |
| List-changed notification | Neither | A notification is a message saying the resource list changed, not something a client lists or calls. | Keep, as part of the resources feature |

### Overlaps, and why they stay

- **`get_note` and `note://{id}` return the same note.** They are two doors to one piece of data: the model opens the tool, the person opens the resource. Removing either would take away one side's control. Both read through the same `getNote()` in `notes.ts`, so they can't drift apart.
- **`list_notes` and `resources/list` both list notes.** `list_notes` pages through every note for the model. `resources/list` fills a client's attach menu and stops at 100 notes, because a picker isn't for paging through hundreds.

### Suggested changes

1. **Move `summarize_notes` to a skill in step 10.** Today it only runs if someone finds it in a menu. As a skill, the model would use the same procedure whenever someone asks for a summary in their own words, and it would load the full instructions only then.
2. **Optional: link resources from tool results.** `list_notes` and `create_note` could also return a `resource_link` (`note://<id>`) for each note. Clients that support it would show the note as something the person can open or attach, joining the model's path and the person's path. Not done here, to keep this step small.
3. **Nothing should move the other way.** No tool should become a resource: three of the four change data, and `list_notes` needs arguments the model chooses. A resource can't do either.

## Change notifications

When `create_note` or `delete_note` changes the notes, the server sends `notifications/resources/list_changed` to clients holding a `subscriptions/listen` stream.

- **What the step expected:** `handler.notify` reaches only streams held by the same handler, in the same copy of the Worker.
- **What we found on Workers:** it's stricter than that. A listen stream belongs to one request, and the runtime forbids any *other* request from touching it ("Cannot perform I/O on behalf of a different request"). So with the SDK's default in-memory bus, a note created by one request could never notify a listener held by another. Cloudflare's `createMcpHandler` doesn't let you change the bus.
- **What we did:** used the MCP SDK's own `createMcpHandler` with a custom `bus` backed by a Durable Object (`NotificationHub`). Each listening request opens and reads its own stream from the hub; changes are published to the hub, which writes to the streams it owns. Notifications now arrive across requests, which a test proves.
- **Checked live:** on the deployed Worker, a `subscriptions/listen` request received the acknowledgement, then a `list_changed` event when a separate request created a note and another when a separate request deleted it.
- **Trade-off:** this replaced Cloudflare's wrapper, so `src/index.ts` re-adds its route, Host/Origin and CORS checks (also tested). A notification is only a "please re-list" hint: a client that misses one sees the change the next time it lists.

## Run, test and deploy

From this folder, using Node.js 24 or later:

```bash
npm install
npm run typecheck   # wrangler types && tsc
npm test            # 24 tests in the Workers runtime
npm run deploy      # Worker learn-mcp-step-03, with its own KV namespace and the NotificationHub Durable Object
```

Step 03 has its own KV namespace (`NOTES_STEP_03`, bound as `NOTES`), so testing it never changes step 02's notes.
