import type { McpServer } from "@modelcontextprotocol/server";
import type { Services } from "../../../composition";
import type { Tool } from "../tool-kit";
import { adminTools } from "./admin";
import { databaseTools } from "./database";

/**
 * Every tool this server offers, one group per feature. All are listed for
 * every caller; each one checks its declared permission against the caller's
 * current role on every call and refuses with a clear message if it's missing.
 */
export const tools: Tool[] = [...databaseTools, ...adminTools];

export function registerTools(server: McpServer, services: Services): void {
  for (const tool of tools) tool.register(server, services);
}
