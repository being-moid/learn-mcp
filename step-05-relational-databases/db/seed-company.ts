// Copies the demo company's sample sales (org_id 'demo', loaded by migration
// 0004) into a real company, so a signed-in user of that company sees data.
//
//   npm run db:seed -- --branch dev --org <organization ID>
//
// The organization ID is the company's ID in the auth database (D1), the
// one in the access token. Find yours with:
//   npx wrangler d1 execute AUTH_DB --remote --command 'SELECT "id", "name" FROM "organization"'
//
// It's safe to run twice: rows the company already has are left alone (ON
// CONFLICT DO NOTHING), and everything runs in one transaction, so a failure
// copies nothing. IDs are copied as they are: they only need to be unique
// within a company, because the company is part of every key.
//
// Plain TypeScript run directly by Node (type stripping).

import { connectToBranch, fail, parseArgs } from "./lib/neon-branch.ts";

const { flags } = parseArgs(process.argv.slice(2));
const org = flags.get("org");
if (!org) fail("Say which company to copy the sample data into: --org <organization ID>.");
if (org === "demo") fail("That's the demo company itself; give your own organization's ID.");
if (!/^[A-Za-z0-9_-]{1,64}$/.test(org)) fail("That doesn't look like an organization ID (letters, digits, - and _ only).");

// Parents before children, so every foreign key finds its row.
const TABLES = [
  { name: "categories", columns: "category_id, name" },
  { name: "products", columns: "product_id, name, category_id, list_price" },
  { name: "customers", columns: "customer_id, name, email, city" },
  { name: "orders", columns: "order_id, order_number, customer_id, order_date" },
  { name: "order_items", columns: "order_id, product_id, quantity, unit_price" },
];

const client = await connectToBranch(flags.get("branch"));
try {
  await client.query("BEGIN");
  for (const { name, columns } of TABLES) {
    // Table and column names come from the list above, never from input; the
    // company ID is a parameter ($1).
    const result = await client.query(
      `INSERT INTO ${name} (org_id, ${columns})
       SELECT $1, ${columns} FROM ${name} WHERE org_id = 'demo'
       ON CONFLICT DO NOTHING`,
      [org],
    );
    console.log(`${name}: ${result.rowCount} row(s) copied`);
  }
  await client.query("COMMIT");
  console.log(`Done: company ${org} has the sample sales.`);
} catch (err) {
  await client.query("ROLLBACK");
  fail(`Nothing was copied: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await client.end();
}
