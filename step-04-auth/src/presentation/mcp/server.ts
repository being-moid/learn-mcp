import { McpServer } from "@modelcontextprotocol/server";
import type { Services } from "../../composition";
import { can } from "../../domain/entities/membership";
import { registerSummarizeNotesPrompt } from "./prompts/summarize-notes";
import { registerNoteResources } from "./resources/notes";
import { registerTools } from "./tools";

// Builds the McpServer for one request. Each request gets its own server and
// its own services (built by the composition root), so nothing from one
// request (arguments, results, registrations) can leak into another, and any
// copy of the Worker can answer any request.
export function createServer(services: Services): McpServer {
  const server = new McpServer({ name: "learn-mcp-step-04", version: "0.1.0" });
  registerTools(server, services);
  // Tools are always listed and refuse calls the caller's role doesn't allow,
  // with a clear message. Resources and the prompt are only offered to
  // callers who may read notes.
  if (can(services.caller, "notes:read")) {
    registerNoteResources(server, services);
    registerSummarizeNotesPrompt(server);
  }
  return server;
}
