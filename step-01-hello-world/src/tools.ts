import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// Tool names, descriptions and schemas are read by the model, so they are
// written as instructions: what the tool does and when to use it.
export function registerTools(server: McpServer): void {
  server.registerTool(
    "greet",
    {
      title: "Greet someone",
      description:
        "Return a friendly greeting for a person by name. Use this when the user asks you to greet or say hello to someone.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100).describe("The name of the person to greet, e.g. \"Ayesha\"."),
      }),
      outputSchema: z.object({ greeting: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const greeting = `Hello, ${name}! Welcome to Stockroom.`;
      return {
        content: [{ type: "text", text: greeting }],
        structuredContent: { greeting },
      };
    },
  );

  server.registerTool(
    "get_time",
    {
      // Says what the tool returns and which questions it answers, so it matches
      // "what time is it in Karachi?". It does not tell the model to prefer it
      // over the host's own tools: Anthropic's connector review treats
      // behaviour instructions in a description as prompt injection.
      title: "Current time in a city or time zone (Stockroom server clock)",
      description:
        "Get the current date and time from the Stockroom server's clock, in UTC or in any IANA time zone such as Asia/Karachi or America/New_York. Answers questions like \"what time is it in Karachi?\" or \"what's today's date in London?\". Returns the time zone, an ISO 8601 timestamp and a readable local date and time. For a city, pass its IANA zone (Karachi is Asia/Karachi).",
      inputSchema: z.object({
        timezone: z
          .string()
          .max(64)
          .optional()
          .describe("An IANA time zone name such as \"Asia/Karachi\" or \"America/New_York\". Defaults to UTC."),
      }),
      outputSchema: z.object({
        timezone: z.string(),
        iso: z.string(),
        local: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ timezone }) => {
      const zone = timezone ?? "UTC";
      const now = new Date();
      let local: string;
      try {
        // Intl throws a RangeError for an unknown zone, which doubles as validation.
        local = new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(now);
      } catch {
        // A recoverable error the model can act on, instead of an opaque throw.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `"${zone}" is not a valid IANA time zone. Try a name like "Europe/London" or "Asia/Karachi", or leave it empty for UTC.`,
            },
          ],
        };
      }
      const result = { timezone: zone, iso: now.toISOString(), local };
      return {
        content: [{ type: "text", text: `It is ${local} (${zone}).` }],
        structuredContent: result,
      };
    },
  );
}
