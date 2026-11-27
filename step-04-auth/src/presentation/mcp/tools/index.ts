import type { McpServer } from "@modelcontextprotocol/server";
import type { Services } from "../../../composition";
import type { Tool } from "../tool-kit";
import { adminTools } from "./admin";
import { noteTools } from "./notes";

/**
 * Every tool this server offers, one group per feature. All are listed for
 * every caller; each one checks its declared permission against the caller's
 * current role on every call and refuses with a clear message if it's missing.
 */
export const tools: Tool[] = [...noteTools, ...adminTools];

export function registerTools(server: McpServer, services: Services): void {
  for (const tool of tools) tool.register(server, services);
}
