import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@neondatabase/serverless";
import { connectToBranch } from "../db/lib/neon-branch.ts";
import { SqlSalesRepository, type QueryFn } from "../src/infrastructure/persistence/neon/sql-sales-repository";
import { DESIGN_COMPARISON_NAMES, type QuestionParameters } from "../src/domain/sales";
import { SalesService } from "../src/application/services/sales-service";
import type { Membership } from "../src/domain/entities/membership";

// Runs the sales repository's real SQL against a Neon branch (dev unless
// NEON_BRANCH says otherwise). Two throwaway companies are made for the run:
// one with a copy of the demo sales, one with nothing. Both are deleted at
// the end, whatever happened.

const run = `test-db-${Date.now().toString(36)}`;
const SEEDED = `${run}-seeded`;
const EMPTY = `${run}-empty`;
const TABLES = [
  ["categories", "category_id, name"],
  ["products", "product_id, name, category_id, list_price"],
  ["customers", "customer_id, name, email, city"],
  ["orders", "order_id, order_number, customer_id, order_date"],
  ["order_items", "order_id, product_id, quantity, unit_price"],
];

let client: Client;
let query: QueryFn;
const all: QuestionParameters = { limit: 25 };

beforeAll(async () => {
  client = await connectToBranch(process.env.NEON_BRANCH ?? "dev");
  query = async (text, params) => (await client.query(text, params)).rows;
  for (const [table, columns] of TABLES) {
    await client.query(`INSERT INTO ${table} (org_id, ${columns}) SELECT $1, ${columns} FROM ${table} WHERE org_id = 'demo'`, [SEEDED]);
  }
});

afterAll(async () => {
  if (!client) return;
  for (const org of [SEEDED, EMPTY]) {
    for (const table of ["orders", "customers", "products", "categories"]) await client.query(`DELETE FROM ${table} WHERE org_id = $1`, [org]);
  }
  await client.end();
});

const seeded = () => new SqlSalesRepository(query, SEEDED);
const empty = () => new SqlSalesRepository(query, EMPTY);

describe("answer_business_question SQL", () => {
  it("monthly_revenue covers 12 months and adds up to the year's revenue", async () => {
    const { rows } = await seeded().answer("monthly_revenue", all);
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2025-12");
    const total = rows.reduce((sum, r) => sum + Number(r.revenue), 0);
    expect(total).toBeCloseTo(37742.41, 2);
    expect(rows.reduce((sum, r) => sum + Number(r.orders), 0)).toBe(169);
  });

  it("average_order_value matches, and is zero (not an error) for a company with no sales", async () => {
    expect((await seeded().answer("average_order_value", all)).rows[0]).toEqual({ orders: 169, revenue: 37742.41, average_order_value: 223.33 });
    expect((await empty().answer("average_order_value", all)).rows[0]).toEqual({ orders: 0, revenue: 0, average_order_value: null });
  });

  it("ranks products and customers by revenue and honours the limit", async () => {
    const products = (await seeded().answer("top_products", { limit: 3 })).rows;
    expect(products).toHaveLength(3);
    expect(Number(products[0].revenue)).toBeGreaterThanOrEqual(Number(products[1].revenue));
    const customers = (await seeded().answer("best_customers", { limit: 25 })).rows;
    expect(customers).toHaveLength(14);
    expect(customers.find((c) => c.customer === "Corner Market")?.city).toBe("Round Rock");
  });

  it("filters by date: one month only", async () => {
    const { rows } = await seeded().answer("monthly_revenue", { from: "2026-03-01", to: "2026-03-31", limit: 10 });
    expect(rows.map((r) => r.month)).toEqual(["2026-03"]);
  });

  it("revenue_by_category and revenue_by_city add up to the total, with one city per customer", async () => {
    const categories = (await seeded().answer("revenue_by_category", all)).rows;
    expect(categories.map((r) => r.category).sort()).toEqual(["Beverages", "Household", "Pantry", "Personal care", "Snacks"]);
    expect(categories.reduce((s, r) => s + Number(r.revenue), 0)).toBeCloseTo(37742.41, 2);
    const cities = (await seeded().answer("revenue_by_city", all)).rows;
    expect(cities.reduce((s, r) => s + Number(r.customers), 0)).toBe(14);
    expect(cities.map((r) => r.city)).not.toContain("Austin");
  });

  it("customer_orders matches part of a name literally, newest first", async () => {
    const { rows } = await seeded().answer("customer_orders", { customer: "corner", limit: 50 });
    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((r) => r.customer))).toEqual(new Set(["Corner Market"]));
    expect(String(rows[0].order_date) >= String(rows.at(-1)!.order_date)).toBe(true);
    // A LIKE wildcard is just a character here: it matches nothing.
    expect((await seeded().answer("customer_orders", { customer: "%", limit: 50 })).rows).toEqual([]);
  });

  it("price_changes shows the Olive Oil price rise (the copy kept on purpose)", async () => {
    const { rows } = await seeded().answer("price_changes", all);
    expect(rows.filter((r) => r.product === "Olive Oil 1L").map((r) => r.sold_at)).toEqual([11.99, 12.99]);
  });

  it("inactive_customers finds Old Town Grocer, whose only order was in March", async () => {
    const { rows } = await seeded().answer("inactive_customers", { from: "2026-06-01", limit: 25 });
    expect(rows.find((r) => r.customer === "Old Town Grocer")?.last_order).toBe("2026-03-12");
  });

  it("largest_orders are sorted by value", async () => {
    const { rows } = await seeded().answer("largest_orders", { limit: 5 });
    expect(rows).toHaveLength(5);
    expect(Number(rows[0].revenue)).toBeGreaterThanOrEqual(Number(rows[4].revenue));
  });

  it("never shows one company another company's sales", async () => {
    for (const question of ["monthly_revenue", "top_products", "best_customers", "revenue_by_category", "revenue_by_city", "largest_orders", "price_changes", "inactive_customers"] as const) {
      expect((await empty().answer(question, all)).rows, question).toEqual([]);
    }
    expect((await empty().answer("customer_orders", { customer: "Corner", limit: 10 })).rows).toEqual([]);
  });
});

describe("compare_designs SQL", () => {
  it("total_revenue: the spreadsheet query has to skip the 7 two-product rows, so it comes out lower", async () => {
    const r = await seeded().compare("total_revenue");
    expect(r.flatRowsSkipped).toBe(7);
    expect(Number(r.normalized[0].values.revenue)).toBeCloseTo(37742.41, 2);
    expect(Number(r.flat[0].values.revenue)).toBeLessThan(37742.41);
  });

  it("customer_contacts: the spreadsheet gives Corner Market two cities and Bluebonnet two emails", async () => {
    const r = await seeded().compare("customer_contacts");
    expect(r.flat.find((x) => x.key === "Corner Market")?.values.cities).toBe("Austin | Round Rock");
    expect(r.flat.find((x) => x.key === "Bluebonnet Grocers")?.values.emails).toContain(" | ");
    expect(r.normalized.find((x) => x.key === "Corner Market")?.values.cities).toBe("Round Rock");
  });

  it("revenue_by_city: Austin appears in the spreadsheet but not in the normalized design", async () => {
    const r = await seeded().compare("revenue_by_city");
    expect(r.flat.map((x) => x.key)).toContain("Austin");
    expect(r.normalized.map((x) => x.key)).not.toContain("Austin");
  });

  it("only the caller's company is on the normalized side", async () => {
    const r = await empty().compare("revenue_by_category");
    expect(r.normalized).toEqual([]);
    expect(r.flat.length).toBeGreaterThan(0);
  });
});

describe("compare_designs findings, on the real data", () => {
  it("gives every comparison at least one finding, in words", async () => {
    const caller = { userId: "u", organizationId: SEEDED, permissions: ["sales:read"] } as unknown as Membership;
    const service = new SalesService(seeded(), caller);
    for (const comparison of DESIGN_COMPARISON_NAMES) {
      const { differences } = await service.compare(comparison);
      if (process.env.SHOW_FINDINGS) console.log(comparison, differences);
      expect(differences.length, comparison).toBeGreaterThan(0);
      expect(differences, comparison).not.toContain("Both designs give the same answer to this question.");
    }
  });
});

describe("describe_schema SQL", () => {
  it("lists the five tables and the spreadsheet, with keys that include org_id", async () => {
    const tables = await seeded().describeSchema();
    expect(tables.map((t) => t.name)).toEqual([
      "public.categories", "public.products", "public.customers", "public.orders", "public.order_items", "staging.flat_sales",
    ]);
    const items = tables.find((t) => t.name === "public.order_items")!;
    expect(items.constraints.find((c) => c.kind === "primary key")?.definition).toBe("PRIMARY KEY (org_id, order_id, product_id)");
    expect(items.constraints.filter((c) => c.kind === "foreign key").map((c) => c.definition)).toContain(
      "FOREIGN KEY (org_id, order_id) REFERENCES orders(org_id, order_id) ON DELETE CASCADE",
    );
    expect(items.columns.map((c) => c.name)).toEqual(["org_id", "order_id", "product_id", "quantity", "unit_price"]);
  });
});
