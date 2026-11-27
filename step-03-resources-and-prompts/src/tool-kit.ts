import type { CallToolResult, McpServer, ServerContext, ServerNotifier, StandardSchemaWithJSON, ToolCallback } from "@modelcontextprotocol/server";
import type { z } from "zod";

// A small helper for defining tools the same way every time. It does three
// jobs, so each tool in tools.ts only has to describe itself:
//   1. It makes the safety hints required, so a tool can't be written without
//      saying whether it reads, changes or destroys data. (Anthropic's
//      directory review requires title, readOnlyHint and destructiveHint.)
//   2. It writes the title once and copies it into the annotations.
//   3. It turns an unexpected error into a short, recoverable tool error
//      instead of a crash, and logs the real error for us.
// It is deliberately thin: each tool is still one plain object, and
// register() is the same server.registerTool call the SDK documents.

// A zod object schema that the SDK can also turn into JSON Schema for the
// tool list. Zod 4 objects are both; saying so lets TypeScript pick the
// right registerTool overload and type each tool's arguments from its schema.
type Schema = z.ZodObject & StandardSchemaWithJSON;

/**
 * Things a tool may need that belong to this request's server, passed in when
 * the tools are registered rather than imported, so nothing request-shaped
 * lives in module scope and there is no circular import with index.ts.
 */
export interface ToolDeps {
  /** The module-level handler's notifier, e.g. notify.resourcesChanged(). */
  notify: ServerNotifier;
}

/**
 * Tells listening clients that the list of resources changed. A notification
 * is only a "please re-list" hint, so failing to deliver one must never fail
 * the tool that triggered it: errors are logged, not thrown.
 */
export function announceResourcesChanged({ notify }: ToolDeps): void {
  try {
    notify.resourcesChanged();
  } catch (err) {
    console.warn(JSON.stringify({ notify: "resourcesChanged", error: err instanceof Error ? err.message : String(err) }));
  }
}

/** What the host is told about a tool's side effects. All required except where noted. */
export interface ToolHints {
  /** True if the tool only reads. Hosts may run it without asking. */
  readOnly: boolean;
  /** True if it deletes or overwrites data. Hosts ask the user first. */
  destructive: boolean;
  /** True if calling it twice has the same effect as once, so it is safe to retry. */
  idempotent: boolean;
  /** True if it reaches outside our own store (the web, another company's API). Defaults to false. */
  openWorld?: boolean;
}

export interface ToolDefinition<I extends Schema, O extends Schema> {
  name: string;
  title: string;
  /** Written for the model: what it does, what it returns, what it doesn't do. */
  description: string;
  input: I;
  output: O;
  hints: ToolHints;
  /** What the model should do if the tool fails unexpectedly. */
  onFailure?: string;
  run: (args: StandardSchemaWithJSON.InferOutput<I>, ctx: ServerContext, deps: ToolDeps) => Promise<CallToolResult>;
}

/** A tool ready to be registered on a server built for one request. */
export interface Tool {
  name: string;
  hints: ToolHints;
  register: (server: McpServer, deps: ToolDeps) => void;
}

export function defineTool<I extends Schema, O extends Schema>(def: ToolDefinition<I, O>): Tool {
  return {
    name: def.name,
    hints: def.hints,
    register(server, deps) {
      const handler = async (args: StandardSchemaWithJSON.InferOutput<I>, ctx: ServerContext): Promise<CallToolResult> => {
        try {
          return await def.run(args, ctx, deps);
        } catch (err) {
          // Log the real error for us; give the model something to act on,
          // without internal details it can't use.
          console.error(JSON.stringify({ tool: def.name, error: err instanceof Error ? err.message : String(err) }));
          return toolError(`${def.title} failed because a service is temporarily unavailable. ${def.onFailure ?? "Try again in a moment."}`);
        }
      };

      server.registerTool<O, I>(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.input,
          outputSchema: def.output,
          annotations: {
            title: def.title,
            readOnlyHint: def.hints.readOnly,
            destructiveHint: def.hints.destructive,
            idempotentHint: def.hints.idempotent,
            openWorldHint: def.hints.openWorld ?? false,
          },
        },
        // The SDK's callback type is conditional ("with an input schema the
        // handler takes args, without one it doesn't"), and TypeScript can't
        // resolve that for a generic I. Every tool here has an input schema,
        // so it is always the "takes args" form: the cast is safe.
        handler as ToolCallback<I>,
      );
    },
  };
}

/** A recoverable error: the model reads the text and can try something else. */
export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
