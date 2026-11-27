// Applies the numbered SQL files in db/migrations/ to one Neon branch, once
// each and in order, and records each one in public.schema_migrations.
//
//   npm run db:migrate -- --branch dev        apply what hasn't run yet
//   npm run db:status  -- --branch dev        list applied and pending, apply nothing
//
// How it connects (and why the production branch is refused): db/lib/neon-branch.ts.
//
// Rules the runner enforces:
//   - Files are named NNNN_description.sql and run in name order.
//   - Each file runs in its own transaction together with its record in
//     schema_migrations, so a failed file leaves no trace and nothing after
//     it runs. Fix it and run again.
//   - A file that has run must never change: its checksum is recorded, and a
//     mismatch stops the run. Change the schema with a new file instead.
//   - Two runs at once can't interleave: the runner holds a Postgres advisory
//     lock for the whole run.
//
// Plain TypeScript run directly by Node (type stripping).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connectToBranch, fail, parseArgs } from "./lib/neon-branch.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
// Any fixed number works; every run of this runner uses the same one.
const LOCK_KEY = 5_000_001;

const { flags } = parseArgs(process.argv.slice(2));
const statusOnly = flags.has("status");
const branch = flags.get("branch");

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const misnamed = files.filter((f) => !FILE_PATTERN.test(f));
if (misnamed.length) fail(`Migration files must be named NNNN_description.sql (lowercase): ${misnamed.join(", ")}`);

const client = await connectToBranch(branch);
try {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name       text        PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await client.query<{ name: string; checksum: string; applied_at: Date }>(
    "SELECT name, checksum, applied_at FROM public.schema_migrations ORDER BY name",
  );
  const applied = new Map(rows.map((r) => [r.name, r]));

  // Every recorded migration must still exist, unchanged.
  for (const row of rows) {
    if (!files.includes(row.name)) fail(`${row.name} ran on this branch but its file is gone from db/migrations/. Restore it.`);
    if (checksum(row.name) !== row.checksum) {
      fail(`${row.name} has changed since it ran on this branch. Never edit a migration that has run: put the change in a new file.`);
    }
  }

  const pending = files.filter((f) => !applied.has(f));
  console.log(`Branch: ${branch ?? "(DATABASE_URL)"}`);
  for (const row of rows) console.log(`  applied  ${row.name}  (${row.applied_at.toISOString()})`);
  for (const name of pending) console.log(`  pending  ${name}`);
  if (!files.length) console.log("  (no migration files yet)");

  if (statusOnly || !pending.length) {
    console.log(pending.length ? `${pending.length} pending; nothing applied (--status).` : "Up to date.");
  } else {
    for (const name of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql); // the whole file; it may hold several statements
        await client.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum(name)]);
        await client.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        fail(`${name} failed and was rolled back; nothing after it ran.\n${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`Done: ${pending.length} migration(s) applied.`);
  }
} finally {
  await client.end(); // also releases the advisory lock
}

function checksum(name: string): string {
  return createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name))).digest("hex");
}

