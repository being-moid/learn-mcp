import { can, type Membership } from "../../domain/entities/membership";
import { ForbiddenError, GuardrailError } from "../../domain/errors";
import type { SalesRepository } from "../../domain/ports/persistence/sales-repository";
import type { Answer, BusinessQuestion, DesignComparison, KeyedRow, QuestionParameters, SchemaTable } from "../../domain/sales";

// Reading the caller's company's sales. The repository was built for the
// caller's company (from the verified membership), so nothing here, or in
// the tools above it, can name a company. This layer checks the permission,
// the rules for a question's parameters, and works out what a design
// comparison shows.

export interface ComparisonResult {
  comparison: DesignComparison;
  flat: KeyedRow[];
  normalized: KeyedRow[];
  flatRowsSkipped: number;
  /** Plain-English findings, one per difference. */
  differences: string[];
}

export class SalesService {
  constructor(
    private readonly sales: SalesRepository,
    private readonly caller: Membership,
  ) {}

  async describeSchema(): Promise<SchemaTable[]> {
    this.require();
    return this.sales.describeSchema();
  }

  async answer(question: BusinessQuestion, parameters: QuestionParameters): Promise<Answer> {
    this.require();
    if (question === "customer_orders" && !parameters.customer) {
      throw new GuardrailError("customer_orders needs `customer`: part of the customer's name, e.g. \"Corner\". Use best_customers to see the names.");
    }
    if (parameters.from && parameters.to && parameters.from > parameters.to) {
      throw new GuardrailError(`\`from\` (${parameters.from}) is after \`to\` (${parameters.to}). Swap them.`);
    }
    return this.sales.answer(question, parameters);
  }

  async compare(comparison: DesignComparison): Promise<ComparisonResult> {
    this.require();
    const rows = await this.sales.compare(comparison);
    return { comparison, ...rows, differences: differences(rows.flat, rows.normalized, rows.flatRowsSkipped) };
  }

  private require(): void {
    if (!can(this.caller, "sales:read")) throw new ForbiddenError("sales:read");
  }
}

/** Compares the two sides key by key and says what differs, in words a model can repeat. */
export function differences(flat: KeyedRow[], normalized: KeyedRow[], flatRowsSkipped: number): string[] {
  const found: string[] = [];
  if (flatRowsSkipped > 0) {
    found.push(
      `The spreadsheet query had to leave out ${flatRowsSkipped} row(s) whose cells hold two products, two prices and two quantities (they can't be summed), so its totals are missing those sales.`,
    );
  }
  if (normalized.length === 0) {
    found.push("Your company has no sales in the normalized tables yet (the sample data hasn't been loaded into it), so there is nothing to compare the spreadsheet with.");
    return found;
  }
  const normalizedByKey = new Map(normalized.map((r) => [r.key, r]));
  const flatKeys = new Set(flat.map((r) => r.key));
  for (const row of flat) {
    // Several values in one answer: the spreadsheet stored the fact more than once and the copies disagree.
    for (const [field, value] of Object.entries(row.values)) {
      if (typeof value === "string" && value.includes(" | ")) {
        const one = normalizedByKey.get(row.key)?.values[field];
        found.push(`${row.key}: the spreadsheet has ${value.split(" | ").length} different ${field} (${value}); the normalized design stores one${one !== undefined ? ` (${one})` : ""}.`);
      }
    }
    const match = normalizedByKey.get(row.key);
    if (!match) {
      found.push(`"${row.key}" appears only in the spreadsheet: ${describe(row.values)}.`);
      continue;
    }
    for (const [field, value] of Object.entries(row.values)) {
      const other = match.values[field];
      if (typeof value === "number" && typeof other === "number" && Math.abs(value - other) >= 0.005) {
        found.push(`${row.key}: ${field} is ${value} in the spreadsheet but ${other} in the normalized tables.`);
      }
    }
  }
  for (const row of normalized) {
    if (!flatKeys.has(row.key)) found.push(`"${row.key}" appears only in the normalized tables: ${describe(row.values)}.`);
  }
  if (found.length === 0) found.push("Both designs give the same answer to this question.");
  return found;
}

function describe(values: Record<string, string | number>): string {
  return Object.entries(values).map(([k, v]) => `${k} ${v}`).join(", ");
}
