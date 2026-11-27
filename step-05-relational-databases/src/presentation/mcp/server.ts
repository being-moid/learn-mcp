import { McpServer } from "@modelcontextprotocol/server";
import type { Services } from "../../composition";
import { registerTools } from "./tools";

// Builds the McpServer for one request. Each request gets its own server and
// its own services (built by the composition root), so nothing from one
// request (arguments, results, registrations) can leak into another, and any
// copy of the Worker can answer any request.
//
// Step 05 replaced the notes (tools, note:// resources and the summarize
// prompt) with the sales database in Neon, so for now the server offers tools only.
export function createServer(services: Services): McpServer {
  const server = new McpServer({ name: "learn-mcp-step-05", version: "0.1.0" });
  registerTools(server, services);
  return server;
}
