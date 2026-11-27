import { McpServer, type ServerNotifier } from "@modelcontextprotocol/server";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerTools } from "./tools";

// The factory the handler calls on every request. Each request gets its own
// McpServer, so nothing from one request (arguments, results, registrations)
// can leak into another, and any copy of the Worker can answer any request.
//
// `notify` belongs to the module-level handler, not to this server: it is how
// tools announce that the list of note:// resources changed.
export function createServer(notify: ServerNotifier): McpServer {
  const server = new McpServer({ name: "learn-mcp-step-03", version: "0.1.0" });
  registerTools(server, { notify });
  registerResources(server);
  registerPrompts(server);
  return server;
}
