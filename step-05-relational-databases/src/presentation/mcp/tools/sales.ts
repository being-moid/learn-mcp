import { z } from "zod";
import { BUSINESS_QUESTIONS, BUSINESS_QUESTION_NAMES, DESIGN_COMPARISONS, DESIGN_COMPARISON_NAMES } from "../../../domain/sales";
import { defineTool } from "../tool-kit";

// Three read-only tools over the sales database. None of them takes SQL, a
// table name or a company: the model chooses from fixed lists, and every
// query runs for the signed-in user's company only (SalesService, built for
// their verified membership). Each returns structured content plus a short
// text summary.

const READ_ONLY = { readOnly: true, destructive: false, idempotent: true } as const;
const cell = z.union([z.string(), z.number(), z.null()]);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD, e.g. 2026-10-01.")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a real date.");

/** "- question: what it answers", one per line, for the tool description. */
function menu(items: Record<string, string>): string {
  return Object.entries(items).map(([name, what]) => `- ${name}: ${what}`).join("\n");
}

/** A few rows as plain text: "month 2026-01, orders 14, revenue 3120.5". */
function rowsAsText(rows: Array<Record<string, unknown>>, max = 25): string {
  const lines = rows.slice(0, max).map((r) => `- ${Object.entries(r).map(([k, v]) => `${k} ${v ?? "none"}`).join(", ")}`);
  return lines.join("\n") + (rows.length > max ? `\n(${rows.length - max} more in the structured result)` : "");
}

const describeSchemaTool = defineTool({
  name: "describe_schema",
  requires: "sales:read",
  title: "Describe the sales database",
  description:
    "Describe the sales database's design: each table, what it is for, its columns and types, and its primary keys, foreign keys, UNIQUE and CHECK constraints. Use it when the user asks how the data is organized, why it is designed this way, or what normal forms mean here. It returns structure only, never sales rows; use answer_business_question for figures.",
  input: z.object({}),
  output: z.object({
    tables: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        columns: z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean() })),
        constraints: z.array(z.object({ name: z.string(), kind: z.string(), definition: z.string() })),
      }),
    ),
  }),
  hints: READ_ONLY,
  onFailure: "Tell the user the sales database can't be reached right now.",
  run: async (_args, _ctx, { sales }) => {
    const tables = await sales.describeSchema();
    const text = tables.length
      ? tables
          .map((t) => `${t.name}: ${t.description}\n  columns: ${t.columns.map((c) => `${c.name} ${c.type}${c.nullable ? "" : " not null"}`).join(", ")}\n${t.constraints.map((c) => `  ${c.kind}: ${c.definition}`).join("\n")}`)
          .join("\n\n")
      : "The sales tables don't exist yet: no migrations have been applied to this database.";
    return { content: [{ type: "text", text }], structuredContent: { tables } };
  },
});

const answerBusinessQuestionTool = defineTool({
  name: "answer_business_question",
  requires: "sales:read",
  title: "Answer a sales question",
  description:
    `Answer one of these questions about the user's company's sales, from its database:\n${menu(BUSINESS_QUESTIONS)}\n` +
    "Pick the question closest to what the user asked, and narrow it with from/to (inclusive dates) when they name a period: for \"last month\", work out that month's first and last day. " +
    "Amounts are in US dollars; revenue is quantity times the price each line was sold at. " +
    "If no question fits, say so rather than stretching one. It only reads data.",
  input: z.object({
    question: z.enum(BUSINESS_QUESTION_NAMES).describe("Which question to answer."),
    from: day.optional().describe("First day included, YYYY-MM-DD. For inactive_customers: customers with no order since this day (default: 60 days ago)."),
    to: day.optional().describe("Last day included, YYYY-MM-DD. Omit for no end."),
    limit: z.number().int().min(1).max(50).default(10).describe("For ranked and listing questions: how many rows at most, 1 to 50. Defaults to 10."),
    customer: z.string().trim().min(1).max(100).optional().describe("For customer_orders only: part of the customer's name, e.g. \"Corner\"."),
  }),
  output: z.object({ question: z.string(), rows: z.array(z.record(z.string(), cell)) }),
  hints: READ_ONLY,
  onFailure: "Tell the user the sales database can't be reached right now.",
  run: async ({ question, from, to, limit, customer }, _ctx, { sales }) => {
    const answer = await sales.answer(question, { from, to, limit, customer });
    const period = from || to ? ` (${from ?? "start"} to ${to ?? "now"})` : "";
    const text = answer.rows.length
      ? `${question}${period}:\n${rowsAsText(answer.rows)}`
      : `No results for ${question}${period}. Your company may have no sales in that period, or none loaded yet.`;
    return { content: [{ type: "text", text }], structuredContent: answer };
  },
});

const keyedRow = z.object({ key: z.string(), values: z.record(z.string(), z.union([z.string(), z.number()])) });

const compareDesignsTool = defineTool({
  name: "compare_designs",
  requires: "sales:read",
  title: "Compare the spreadsheet with the normalized design",
  description:
    `Ask one question of both the original flat sales spreadsheet (one row per order line, customer and product details retyped on every row) and the normalized tables, and report where the answers differ and why. Comparisons:\n${menu(DESIGN_COMPARISONS)}\n` +
    "Use it when the user asks why the database was normalized, why the old spreadsheet gave wrong or conflicting answers (e.g. a customer in two cities), or what update, insert and delete anomalies are. It only reads data. For ordinary sales figures use answer_business_question.",
  input: z.object({
    comparison: z.enum(DESIGN_COMPARISON_NAMES).describe("Which question to ask of both designs."),
  }),
  output: z.object({
    comparison: z.string(),
    flat: z.array(keyedRow),
    normalized: z.array(keyedRow),
    flatRowsSkipped: z.number(),
    differences: z.array(z.string()),
  }),
  hints: READ_ONLY,
  onFailure: "Tell the user the sales database can't be reached right now.",
  run: async ({ comparison }, _ctx, { sales }) => {
    const result = await sales.compare(comparison);
    const text = `${comparison}, spreadsheet vs normalized tables:\n${result.differences.map((d) => `- ${d}`).join("\n")}`;
    return { content: [{ type: "text", text }], structuredContent: result };
  },
});

export const salesTools = [describeSchemaTool, answerBusinessQuestionTool, compareDesignsTool];
