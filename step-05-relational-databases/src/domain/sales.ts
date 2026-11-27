// The sales questions the server can answer, as a fixed list. The model
// picks one by name; each is a query we wrote and reviewed (in the sales
// repository), with only values (dates, a limit, a customer name) passed in
// as parameters. The model never writes SQL.

export const BUSINESS_QUESTIONS = {
  monthly_revenue: "Revenue and number of orders per calendar month.",
  top_products: "The products that earned the most, with units sold and revenue.",
  best_customers: "The customers who spent the most, with their city and number of orders.",
  revenue_by_category: "Revenue and units sold per product category.",
  revenue_by_city: "Revenue and number of customers per customer city.",
  average_order_value: "Number of orders, total revenue and the average order value.",
  largest_orders: "The biggest orders by value, with customer, date and number of lines.",
  customer_orders: "One customer's orders, newest first (needs `customer`, part of the customer's name).",
  price_changes: "Products sold at more than one price, with when each price applied.",
  inactive_customers: "Customers with no order since `from` (default: the last 60 days), with their last order date.",
} as const;

export type BusinessQuestion = keyof typeof BUSINESS_QUESTIONS;
export const BUSINESS_QUESTION_NAMES = Object.keys(BUSINESS_QUESTIONS) as [BusinessQuestion, ...BusinessQuestion[]];

/** What a question may be narrowed by. Every value is passed to SQL as a parameter. */
export interface QuestionParameters {
  /** First day included, YYYY-MM-DD. */
  from?: string;
  /** Last day included, YYYY-MM-DD. */
  to?: string;
  /** How many rows at most, for the ranked questions. */
  limit: number;
  /** Part of a customer's name, for customer_orders. */
  customer?: string;
}

/** One answer: rows of plain values, small enough for a model to read. */
export interface Answer {
  question: BusinessQuestion;
  rows: Array<Record<string, string | number | null>>;
}

// The questions compare_designs runs against both the flat spreadsheet
// (staging.flat_sales) and the normalized tables, to show what the flat
// design gets wrong.
export const DESIGN_COMPARISONS = {
  total_revenue: "Total revenue. The spreadsheet can't sum cells holding two prices, so a query on it has to skip them.",
  revenue_by_category: "Revenue per category. In the spreadsheet a product can be filed under two categories.",
  revenue_by_city: "Revenue per city. In the spreadsheet a customer who moved appears in two cities.",
  customer_contacts: "Each customer's city and email. In the spreadsheet they are retyped on every row and disagree.",
} as const;

export type DesignComparison = keyof typeof DESIGN_COMPARISONS;
export const DESIGN_COMPARISON_NAMES = Object.keys(DESIGN_COMPARISONS) as [DesignComparison, ...DesignComparison[]];

/** Rows keyed by what they describe (a category, a city, a customer), each with one or more values. */
export interface KeyedRow {
  key: string;
  values: Record<string, string | number>;
}

/** One comparison's two sides, before the differences are worked out. */
export interface DesignComparisonRows {
  flat: KeyedRow[];
  normalized: KeyedRow[];
  /** Spreadsheet rows the flat query had to leave out (cells with two values). */
  flatRowsSkipped: number;
}

/** A table of the sales schema, as describe_schema reports it. */
export interface SchemaTable {
  name: string;
  description: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
  constraints: Array<{ name: string; kind: "primary key" | "foreign key" | "unique" | "check"; definition: string }>;
}

/** What each table is for, written for the model. */
export const TABLE_DESCRIPTIONS: Record<string, string> = {
  "public.categories": "Product categories. One row per category per company.",
  "public.products": "The catalog. Each product belongs to one category; list_price is today's price.",
  "public.customers": "The company's customers (shops). City and email are stored once, here.",
  "public.orders": "One row per order: which customer, which day. Points at customers.",
  "public.order_items": "Order lines: how many of which product on which order, and unit_price, the price it sold at (a copy kept on purpose so later price changes don't rewrite past sales).",
  "staging.flat_sales": "The original spreadsheet, one row per order line with customer and product details repeated. Kept only to show what normalization fixed; not company data, and never used for answers.",
};
