# Bad tool vs good tool: `remove` vs `delete_note`

Both tools delete a note from Workers KV and call the same `deleteNote()` function. The only difference is how they are **described to the model**. The model never reads our code: it decides whether and how to call a tool only from its name, description, schema and annotations.

- Bad: [`src/bad-tool.ts`](src/bad-tool.ts), which is never registered or deployed.
- Good: `deleteNoteTool` in [`src/tools.ts`](src/tools.ts), built with `defineTool` from [`src/tool-kit.ts`](src/tool-kit.ts).

## What the model sees

**Bad (`remove`):**
```json
{ "name": "remove", "inputSchema": { "type": "object", "properties": { "x": {} } } }
```

**Good (`delete_note`):**
```json
{
  "name": "delete_note",
  "title": "Delete a note",
  "description": "Permanently delete one sales note by its ID. This cannot be undone. If you don't have the ID, call list_notes first; never guess an ID.",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string", "format": "uuid", "description": "The note's ID, as returned by create_note or list_notes…" } },
    "required": ["id"]
  },
  "annotations": { "title": "Delete a note", "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false }
}
```

## Side by side

| | Bad: `remove` | Good: `delete_note` | Why it matters |
| --- | --- | --- | --- |
| **Name** | `remove`: remove what? A note, a tag, a user? | `delete_note`: a verb and the thing it acts on | The name is the first thing the model matches against the user's request. A vague name gets picked for the wrong requests, or skipped for the right ones. |
| **Description** | None | Says what it does, that it can't be undone, and to call `list_notes` first | With no description the model has to guess from the name. The good one also stops the model inventing an ID. |
| **Input** | `x`, of any type, optional | `id`, a required UUID, described | The model can't know `x` is a note ID, so it may pass a title like "Karachi Foods". The good schema rejects that before any code runs, with an error naming the field. |
| **Annotations** | None, so hosts must assume the worst | `destructiveHint: true` | Hosts use this to ask the user before deleting. Without it, Claude and ChatGPT can't tell this from a harmless read. |
| **Not found** | Throws `"not found"` | `isError` result: "No note has the ID … Call list_notes to see the IDs that exist…" | A thrown error is a dead end. The good message tells the model what to do next. |
| **Success** | `"ok"` | `"Deleted note <id>."` plus structured `{ id, deleted: true }` | "ok" doesn't say what was deleted, so the model can't confirm it to the user. |
| **Store failure** | Crashes, possibly leaking internal error text | Recoverable message: "not confirmed deleted: call get_note to check before trying again" | Handled once by `defineTool` for every tool. |

## Why the good version gets called correctly more often

1. **The model can find it.** "Delete the note about Ali" maps clearly to `delete_note`. It doesn't map clearly to `remove`, especially once a server has other tools that could also "remove" things.
2. **The model can fill it in.** A described, required `id` that must be a UUID tells the model exactly what to pass, and the description says where to get it (`list_notes`). With `x: any`, it has to guess.
3. **Mistakes get caught early.** The schema rejects bad input before our code runs, with an error naming the field, so the model corrects itself on the next call.
4. **The user stays in control.** `destructiveHint` makes the host confirm before deleting. `remove` could delete data without the user being asked.
5. **Failures lead somewhere.** Every error says what to try next, so one wrong call doesn't end the conversation.

## How `defineTool` prevents the bad version

`defineTool` won't type-check without a `title`, a `description`, an input schema, an output schema and all the safety `hints`. So the "no description" and "no annotations" mistakes can't even be written with it. Errors thrown by `run` also become recoverable results automatically.

The vague name, the loose `x: any` schema and an unhelpful description are still possible: those need a person, or a reviewer like Claude, to catch them.

## How this was checked

This comparison is reasoned from how hosts choose tools: the model reads only the tool list, and Anthropic's tool-design guidance and connector review criteria describe the same rules. It was **not** measured by running both tools side by side in Claude or ChatGPT. Prompt 7 tests the good tools' selection with real prompts.
