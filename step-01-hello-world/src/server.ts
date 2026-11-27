import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools";

// The factory the handler calls on every request. Each request gets its own
// McpServer, so nothing from one request (arguments, results, registrations)
// can leak into another, and any copy of the Worker can answer any request.
export function createServer(): McpServer {
  const server = new McpServer({ name: "learn-mcp-step-01", version: "0.1.0" });
  registerTools(server);
  return server;
}
