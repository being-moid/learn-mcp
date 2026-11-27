import type { SalesRepository } from "../../../domain/ports/persistence/sales-repository";
import {
  TABLE_DESCRIPTIONS,
  type Answer,
  type BusinessQuestion,
  type DesignComparison,
  type DesignComparisonRows,
  type KeyedRow,
  type QuestionParameters,
  type SchemaTable,
} from "../../../domain/sales";

// The sales queries, for one company. Every one is fixed SQL written here and
// reviewed; the only things that vary are values passed as parameters ($1,
// $2, ...), which Postgres never runs as SQL. The model chooses a question by
// name; it can't change the SQL.
//
// $1 is always the company (org_id), set once in the constructor from the
// caller's verified membership. Every query filters every table by it, and
// the joins match on org_id too, so they can't cross into another company.
//
// The queries run through a QueryFn, so the same SQL runs in the Worker (over
// Neon's HTTP driver) and in the database tests (over a Node connection).

/** Runs one parameterized statement and returns its rows. */
export type QueryFn = (text: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

// Every question reads this company's order lines in [from, to]: FROM_LINES
// joins them, IN_PERIOD filters them. Dates are compared as dates; a missing
// bound means "no limit".
const FROM_LINES = `
  FROM orders o
  JOIN order_items i ON i.org_id = o.org_id AND i.order_id = o.order_id`;
const IN_PERIOD = `
  o.org_id = $1
  AND o.order_date >= coalesce($2::date, '-infinity'::date)
  AND o.order_date <= coalesce($3::date, 'infinity'::date)`;
// Joins to the rest of the schema; each matches on org_id as well as the ID.
const WITH_PRODUCTS = `
  JOIN products p   ON p.org_id = i.org_id AND p.product_id = i.product_id
  JOIN categories c ON c.org_id = p.org_id AND c.category_id = p.category_id`;
const WITH_CUSTOMERS = `
  JOIN customers cu ON cu.org_id = o.org_id AND cu.customer_id = o.customer_id`;

const REVENUE = "sum(i.quantity * i.unit_price)";

// Every question is sent the same five parameters, but not every question
// uses all five, and Postgres refuses a statement given a parameter it never
// mentions. This clause, put in front of each one, mentions all five and
// gives each its type; it is never read.
const PARAMETERS = "WITH parameters AS (SELECT $1::text AS org_id, $2::date AS from_date, $3::date AS to_date, $4::integer AS max_rows, $5::text AS customer)";

/** SQL per question. Parameters: $1 org, $2 from, $3 to, $4 limit, $5 customer. */
const QUESTIONS: Record<BusinessQuestion, string> = {
  monthly_revenue: `
    SELECT to_char(date_trunc('month', o.order_date), 'YYYY-MM') AS month,
           count(DISTINCT o.order_id) AS orders, ${REVENUE} AS revenue
    ${FROM_LINES}
    WHERE ${IN_PERIOD}
    GROUP BY 1 ORDER BY 1`,

  top_products: `
    SELECT p.name AS product, c.name AS category, sum(i.quantity) AS units, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_PRODUCTS}
    WHERE ${IN_PERIOD}
    GROUP BY p.name, c.name ORDER BY revenue DESC, p.name LIMIT $4`,

  best_customers: `
    SELECT cu.name AS customer, cu.city, count(DISTINCT o.order_id) AS orders, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_CUSTOMERS}
    WHERE ${IN_PERIOD}
    GROUP BY cu.name, cu.city ORDER BY revenue DESC, cu.name LIMIT $4`,

  revenue_by_category: `
    SELECT c.name AS category, sum(i.quantity) AS units, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_PRODUCTS}
    WHERE ${IN_PERIOD}
    GROUP BY c.name ORDER BY revenue DESC`,

  revenue_by_city: `
    SELECT cu.city, count(DISTINCT cu.customer_id) AS customers, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_CUSTOMERS}
    WHERE ${IN_PERIOD}
    GROUP BY cu.city ORDER BY revenue DESC`,

  average_order_value: `
    SELECT count(DISTINCT o.order_id) AS orders, coalesce(${REVENUE}, 0) AS revenue,
           round(coalesce(${REVENUE}, 0) / nullif(count(DISTINCT o.order_id), 0), 2) AS average_order_value
    ${FROM_LINES}
    WHERE ${IN_PERIOD}`,

  largest_orders: `
    SELECT o.order_number, o.order_date::text AS order_date, cu.name AS customer, count(*) AS lines, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_CUSTOMERS}
    WHERE ${IN_PERIOD}
    GROUP BY o.order_number, o.order_date, cu.name ORDER BY revenue DESC, o.order_number LIMIT $4`,

  // position() matches the name literally: % and _ in the input mean nothing special.
  customer_orders: `
    SELECT cu.name AS customer, o.order_number, o.order_date::text AS order_date, count(*) AS lines, ${REVENUE} AS revenue
    ${FROM_LINES} ${WITH_CUSTOMERS}
    WHERE ${IN_PERIOD} AND position(lower($5::text) IN lower(cu.name)) > 0
    GROUP BY cu.name, o.order_number, o.order_date ORDER BY o.order_date DESC, o.order_number DESC LIMIT $4`,

  price_changes: `
    SELECT p.name AS product, p.list_price, i.unit_price AS sold_at, count(*) AS lines,
           min(o.order_date)::text AS first_sold, max(o.order_date)::text AS last_sold
    ${FROM_LINES} ${WITH_PRODUCTS}
    WHERE ${IN_PERIOD}
      AND i.product_id IN (
        SELECT product_id FROM order_items WHERE org_id = $1 GROUP BY product_id HAVING count(DISTINCT unit_price) > 1
      )
    GROUP BY p.name, p.list_price, i.unit_price ORDER BY p.name, first_sold`,

  // Not built on the order lines: it lists customers, including ones with no orders at all.
  inactive_customers: `
    SELECT cu.name AS customer, cu.city, max(o.order_date)::text AS last_order
    FROM customers cu
    LEFT JOIN orders o ON o.org_id = cu.org_id AND o.customer_id = cu.customer_id
    WHERE cu.org_id = $1
    GROUP BY cu.name, cu.city
    HAVING max(o.order_date) IS NULL OR max(o.order_date) < coalesce($2::date, current_date - 60)
    ORDER BY last_order NULLS FIRST, cu.name LIMIT $4`,
};

// The comparisons: the same question asked of the spreadsheet, as someone
// would write it against that design, and of this company's normalized tables.
// The flat queries leave out rows whose cells hold two values (they can't be
// summed). $1 is the company, for the normalized side only: the spreadsheet is
// the sample data the companies were seeded from, not any company's rows.
const SINGLE_VALUE_ROWS = "product_name NOT LIKE '%,%'";

const COMPARISONS: Record<DesignComparison, { flat: string; normalized: string }> = {
  total_revenue: {
    flat: `SELECT 'all sales' AS key, sum(unit_price::numeric * quantity::integer) AS revenue
           FROM staging.flat_sales WHERE ${SINGLE_VALUE_ROWS}`,
    normalized: `SELECT 'all sales' AS key, coalesce(sum(quantity * unit_price), 0) AS revenue
                 FROM order_items WHERE org_id = $1`,
  },
  revenue_by_category: {
    flat: `SELECT category AS key, sum(unit_price::numeric * quantity::integer) AS revenue
           FROM staging.flat_sales WHERE ${SINGLE_VALUE_ROWS} GROUP BY category ORDER BY 1`,
    normalized: `SELECT c.name AS key, sum(i.quantity * i.unit_price) AS revenue
                 FROM order_items i
                 JOIN products p   ON p.org_id = i.org_id AND p.product_id = i.product_id
                 JOIN categories c ON c.org_id = p.org_id AND c.category_id = p.category_id
                 WHERE i.org_id = $1 GROUP BY c.name ORDER BY 1`,
  },
  revenue_by_city: {
    flat: `SELECT customer_city AS key, sum(unit_price::numeric * quantity::integer) AS revenue,
                  count(DISTINCT customer_name) AS customers
           FROM staging.flat_sales WHERE ${SINGLE_VALUE_ROWS} GROUP BY customer_city ORDER BY 1`,
    normalized: `SELECT cu.city AS key, sum(i.quantity * i.unit_price) AS revenue, count(DISTINCT cu.customer_id) AS customers
                 FROM order_items i
                 JOIN orders o     ON o.org_id = i.org_id AND o.order_id = i.order_id
                 JOIN customers cu ON cu.org_id = o.org_id AND cu.customer_id = o.customer_id
                 WHERE i.org_id = $1 GROUP BY cu.city ORDER BY 1`,
  },
  customer_contacts: {
    flat: `SELECT customer_name AS key,
                  string_agg(DISTINCT customer_city, ' | ') AS cities, string_agg(DISTINCT customer_email, ' | ') AS emails
           FROM staging.flat_sales GROUP BY customer_name ORDER BY 1`,
    normalized: `SELECT name AS key, city AS cities, email AS emails FROM customers WHERE org_id = $1 ORDER BY 1`,
  },
};

// The tables describe_schema reports, in the order a reader should meet them.
const SCHEMA_TABLES = ["public.categories", "public.products", "public.customers", "public.orders", "public.order_items", "staging.flat_sales"];

export class SqlSalesRepository implements SalesRepository {
  constructor(
    private readonly query: QueryFn,
    private readonly organizationId: string,
  ) {}

  async describeSchema(): Promise<SchemaTable[]> {
    // The catalog, not a hand-written copy, so the answer always matches the
    // migrations that actually ran. Structure only: no company's rows.
    const columns = await this.query(
      `SELECT table_schema || '.' || table_name AS table_name, column_name, data_type, is_nullable = 'YES' AS nullable
       FROM information_schema.columns
       WHERE table_schema || '.' || table_name = ANY($1::text[])
       ORDER BY table_schema, table_name, ordinal_position`,
      [SCHEMA_TABLES],
    );
    const constraints = await this.query(
      `SELECT n.nspname || '.' || t.relname AS table_name, c.conname AS name, c.contype AS kind, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t     ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname || '.' || t.relname = ANY($1::text[]) AND c.contype IN ('p', 'f', 'u', 'c')
       ORDER BY 1, position(c.contype IN 'pufc'), c.conname`,
      [SCHEMA_TABLES],
    );
    const kinds = { p: "primary key", f: "foreign key", u: "unique", c: "check" } as const;
    return SCHEMA_TABLES.map((table) => ({
      name: table,
      description: TABLE_DESCRIPTIONS[table] ?? "",
      columns: columns
        .filter((c) => c.table_name === table)
        .map((c) => ({ name: String(c.column_name), type: String(c.data_type), nullable: Boolean(c.nullable) })),
      constraints: constraints
        .filter((c) => c.table_name === table)
        .map((c) => ({ name: String(c.name), kind: kinds[c.kind as keyof typeof kinds], definition: String(c.definition) })),
    })).filter((t) => t.columns.length > 0); // a table not created yet (migrations not run) is left out
  }

  async answer(question: BusinessQuestion, p: QuestionParameters): Promise<Answer> {
    const rows = await this.query(`${PARAMETERS} ${QUESTIONS[question]}`, [this.organizationId, p.from ?? null, p.to ?? null, p.limit, p.customer ?? null]);
    return { question, rows: rows.map(plain) };
  }

  async compare(comparison: DesignComparison): Promise<DesignComparisonRows> {
    const { flat, normalized } = COMPARISONS[comparison];
    const [flatRows, normalizedRows, skipped] = await Promise.all([
      this.query(flat, []),
      this.query(normalized, [this.organizationId]),
      comparison === "customer_contacts"
        ? Promise.resolve([{ n: 0 }])
        : this.query(`SELECT count(*) AS n FROM staging.flat_sales WHERE NOT (${SINGLE_VALUE_ROWS})`, []),
    ]);
    return { flat: flatRows.map(keyed), normalized: normalizedRows.map(keyed), flatRowsSkipped: Number(skipped[0]?.n ?? 0) };
  }
}

/** Postgres sends numeric and bigint as text (they can exceed a JS number); these are small, so make them numbers. */
function plain(row: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "number") out[k] = v;
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !/date|order_number|month/.test(k)) out[k] = Number(v);
    else out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  }
  return out;
}

function keyed(row: Record<string, unknown>): KeyedRow {
  const { key, ...rest } = plain(row);
  return { key: String(key), values: rest as Record<string, string | number> };
}
