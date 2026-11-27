import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON, ToolCallback } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { Services } from "../../composition";
import { can } from "../../domain/entities/membership";
import { ForbiddenError, GuardrailError, NotFoundError } from "../../domain/errors";
import type { Permission } from "../../domain/permissions";

// A small helper for defining tools the same way every time. It does three
// jobs, so each tool in mcp/tools/ only has to describe itself:
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
  /** The permission the caller's role must grant, checked before `run` on every call. */
  requires: Permission;
  /** What the model should do if the tool fails unexpectedly. */
  onFailure?: string;
  /**
   * The tool's work. It gets this request's services (built by the
   * composition root) rather than importing storage, so tools stay in the
   * presentation layer and the business rules live in the services.
   */
  run: (args: StandardSchemaWithJSON.InferOutput<I>, ctx: ServerContext, services: Services) => Promise<CallToolResult>;
}

/** A tool ready to be registered on a server built for one request. */
export interface Tool {
  name: string;
  hints: ToolHints;
  requires: Permission;
  register: (server: McpServer, services: Services) => void;
}

export function defineTool<I extends Schema, O extends Schema>(def: ToolDefinition<I, O>): Tool {
  return {
    name: def.name,
    hints: def.hints,
    requires: def.requires,
    register(server, services) {
      const handler = async (args: StandardSchemaWithJSON.InferOutput<I>, ctx: ServerContext): Promise<CallToolResult> => {
        // Checked on every call, against the caller's role as it is now.
        if (!can(services.caller, def.requires)) return toolError(new ForbiddenError(def.requires).message);
        try {
          return await def.run(args, ctx, services);
        } catch (err) {
          // Reasons the caller can act on (their role, a guardrail, a missing
          // role or member) go back as they are.
          if (err instanceof ForbiddenError || err instanceof GuardrailError || err instanceof NotFoundError) return toolError(err.message);
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
