import { z } from "zod";
import { defineTool } from "../tool-kit";

// Proves the server can reach its business database (Neon) and shows which
// migrations have run there. The sales tools (describe_schema,
// answer_business_question, compare_designs) build on the same connection.

const databaseStatusTool = defineTool({
  name: "database_status",
  requires: "sales:read",
  title: "Check the sales database",
  description:
    "Check that Stockroom's sales database is reachable and list the schema migrations applied to it, oldest first. Use it when the user asks whether the database is connected or up to date, or before explaining that sales data isn't available yet. It returns no business data.",
  input: z.object({}),
  output: z.object({
    connected: z.boolean(),
    migrations: z.array(z.object({ name: z.string(), appliedAt: z.string() })),
  }),
  hints: { readOnly: true, destructive: false, idempotent: true },
  onFailure: "Tell the user the sales database can't be reached right now, and try again later.",
  run: async (_args, _ctx, { businessDatabase }) => {
    const { migrations } = await businessDatabase.status();
    const text = migrations.length
      ? `Connected. ${migrations.length} migration(s) applied:\n${migrations.map((m) => `- ${m.name} (${m.appliedAt})`).join("\n")}`
      : "Connected, but no migrations have been applied yet, so there are no sales tables.";
    return { content: [{ type: "text", text }], structuredContent: { connected: true, migrations } };
  },
});

export const databaseTools = [databaseStatusTool];
