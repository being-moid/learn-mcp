// Runs a file of SQL statements against one Neon branch and prints each
// statement's result, so you can read a query, predict its answer, then check.
//
//   npm run db:sql -- --branch dev db/queries/flat-sales-anomalies.sql
//
// Statements end with a semicolon at the end of a line. The comment lines
// just above a statement are printed as its title. A statement that fails
// prints its error and the run carries on (a demonstration can show an error
// on purpose). Wrap anything that changes data in BEGIN ... ROLLBACK so the
// branch is left as it was.
//
// Plain TypeScript run directly by Node (type stripping).

import { readFileSync } from "node:fs";
import { connectToBranch, fail, parseArgs } from "./lib/neon-branch.ts";

const { flags, positional } = parseArgs(process.argv.slice(2));
const file = positional[0];
if (!file) fail("Give a .sql file to run, e.g. npm run db:sql -- --branch dev db/queries/flat-sales-anomalies.sql");

const statements: Array<{ title: string; sql: string }> = [];
let title: string[] = [];
let body: string[] = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!body.length && line.trim().startsWith("--")) {
    title.push(line.trim().replace(/^--\s?/, ""));
    continue;
  }
  if (!body.length && !line.trim()) {
    title = [];
    continue;
  }
  body.push(line);
  if (line.trimEnd().endsWith(";")) {
    statements.push({ title: title.join("\n"), sql: body.join("\n").trim() });
    title = [];
    body = [];
  }
}

const client = await connectToBranch(flags.get("branch"));
try {
  for (const { title, sql } of statements) {
    if (title) console.log(`\n-- ${title.replace(/\n/g, "\n-- ")}`);
    console.log(sql);
    try {
      const result = await client.query(sql);
      if (result.rows.length) console.table(result.rows);
      else console.log(`(${result.command}${result.rowCount != null ? ` ${result.rowCount}` : ""})`);
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
} finally {
  await client.end();
}
