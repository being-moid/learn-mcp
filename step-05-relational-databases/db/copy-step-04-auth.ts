// Copies step 04's auth database (D1) into step 05's, so step 05 starts with
// the same users (who sign in with the same passwords), companies, members,
// roles, invitations and OAuth clients. From there, step 05's own outbox
// carries everything on to the Neon read models.
//
//   node db/copy-step-04-auth.ts            show what would be copied, change nothing
//   node db/copy-step-04-auth.ts --apply    do it (step 05's D1 must have no users yet)
//
// What happens with --apply:
//   1. Step 05's D1 migrations are applied, so its tables (and outbox
//      triggers) exist.
//   2. Each table's rows are exported from step 04 and imported into step 05,
//      parents before children. The import fires step 05's outbox triggers,
//      so its outbox gets a full history of its own (user.created,
//      organization.created, ...), and the read-model consumer replays it to
//      Neon from the beginning. (No backfill: the outbox isn't empty.)
//   3. Roles get step 05's permissions: any role that could read notes can
//      read sales, and the notes permissions are removed (the same change as
//      D1 migration 0007, which ran in step 1 while there were no roles yet).
//   4. The invitation-email consumer is moved to the end of the new outbox,
//      so copied invitations aren't emailed a second time.
//
// Not copied: step 04's outbox and consumer positions (step 05 has its own),
// D1's migration bookkeeping, and rate-limit counters.
//
// Signing keys (jwks) and OAuth secrets are encrypted with the auth secret,
// which is why step 05 uses step 04's (wrangler.jsonc). Tokens step 04 issued
// name step 04's address as issuer and audience, so step 05 refuses them:
// clients connect again, and users sign in with their existing passwords.
//
// The export holds password hashes and tokens. It's written to a private
// temporary folder and deleted when the script ends, whatever happens.
//
// Plain TypeScript run directly by Node (type stripping).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FROM = "learn-mcp-auth-step-04";
const TO = "learn-mcp-auth-step-05";

// Parents before children, so every foreign key finds its row.
const TABLES = [
  "tenant",
  "user",
  "tenant_admin",
  "organization",
  "member",
  "invitation",
  "account",
  "session",
  "verification",
  "jwks",
  "org_role",
  "org_role_permission",
  "org_member_role",
  "oauthClient",
  "oauthResource",
  "oauthClientResource",
  "oauthClientAssertion",
  "oauthConsent",
  "oauthAccessToken",
  "oauthRefreshToken",
];

const apply = process.argv.includes("--apply");

function wrangler(args: string[]): string {
  return execFileSync("npx", ["--no-install", "wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Runs one SQL command on a remote D1 and returns its rows. */
function d1(database: string, sql: string): Array<Record<string, unknown>> {
  const out = wrangler(["d1", "execute", database, "--remote", "--json", "--command", sql]);
  return (JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>)[0].results;
}

function counts(database: string): Record<string, number> {
  const sql = `SELECT ${TABLES.map((t) => `(SELECT count(*) FROM "${t}") AS "${t}"`).join(", ")}`;
  return d1(database, sql)[0] as Record<string, number>;
}

const source = counts(FROM);
console.log(`Rows in ${FROM}:`);
for (const t of TABLES) console.log(`  ${t.padEnd(22)} ${source[t]}`);

if (!apply) {
  console.log(`\nNothing changed. Run with --apply to copy these into ${TO}.`);
  process.exit(0);
}

console.log(`\n1. Applying ${TO}'s migrations`);
wrangler(["d1", "migrations", "apply", TO, "--remote"]);

const existing = d1(TO, `SELECT count(*) AS n FROM "user"`)[0].n as number;
if (existing > 0) {
  console.error(`${TO} already has ${existing} user(s). Copying would collide with them; nothing was copied.`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "copy-auth-"));
try {
  console.log(`2. Copying rows from ${FROM} to ${TO}`);
  for (const table of TABLES) {
    if (!source[table]) continue;
    const file = join(dir, `${table}.sql`);
    wrangler(["d1", "export", FROM, "--remote", "--no-schema", "--table", table, "--output", file]);
    // The export only holds INSERTs for this table; check before running it.
    const statements = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    const unexpected = statements.filter((l) => !l.startsWith(`INSERT INTO "${table}"`) && !l.startsWith(`INSERT INTO ${table}`) && !l.startsWith("PRAGMA"));
    if (unexpected.length) throw new Error(`The export of ${table} holds something other than its rows: ${unexpected[0].slice(0, 80)}`);
    writeFileSync(file, statements.join("\n") + "\n");
    wrangler(["d1", "execute", TO, "--remote", "--file", file, "--yes"]);
    console.log(`   ${table}: ${statements.filter((l) => l.startsWith("INSERT")).length} row(s)`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("3. Giving roles step 05's permissions (notes:read becomes sales:read)");
d1(TO, `INSERT OR IGNORE INTO "org_role_permission" ("roleId", "permission") SELECT "roleId", 'sales:read' FROM "org_role_permission" WHERE "permission" = 'notes:read'`);
d1(TO, `DELETE FROM "org_role_permission" WHERE "permission" IN ('notes:read', 'notes:write', 'notes:delete')`);

console.log("4. Moving the invitation-email consumer past the copied invitations");
d1(TO, `UPDATE "outbox_consumer" SET "last_seq" = (SELECT coalesce(max("seq"), 0) FROM "outbox"), "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "name" = 'invitation-email'`);

const copied = counts(TO);
const outbox = d1(TO, `SELECT count(*) AS n FROM "outbox"`)[0].n;
console.log(`\nDone. Rows in ${TO}:`);
for (const t of TABLES) console.log(`  ${t.padEnd(22)} ${copied[t]}${copied[t] !== source[t] ? `  (step 04: ${source[t]})` : ""}`);
console.log(`  outbox                 ${outbox} event(s), for the Neon read models`);
