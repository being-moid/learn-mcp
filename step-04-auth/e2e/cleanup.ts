// Deletes what an end-to-end run created, and nothing else. The workflow
// runs it after the tests whether they passed, failed or were cancelled.
//
//   node e2e/cleanup.ts --target staging    --run <run-id>
//   node e2e/cleanup.ts --target production --run <run-id>
//   node e2e/cleanup.ts --target staging    --stale-hours 24   (leftovers of runs whose cleanup never ran)
//
// What belongs to a run: users whose email carries its tag (e2e-<run>-) on
// the target's test domain, the companies and tenants those users own, and
// OAuth clients named with the tag. It refuses to delete anything if a
// company it would delete has a member who isn't from an e2e run: that would
// mean a real person had been added to a test company, and a person decides.
//
// The outbox is left alone: it's an append-only log other systems read, and
// the deletions below record their own "deleted" events in it.
//
// Plain TypeScript run directly by Node (type stripping), hence the .ts imports.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMAIL_DOMAINS, RUN_ID_PATTERN, type Target } from "./lib/config.ts";
import { d1, d1File, kv } from "./lib/d1.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");

const on = args.get("target") as Target;
if (on !== "staging" && on !== "production") fail('--target must be "staging" or "production"');
const run = args.get("run");
const staleHours = args.has("stale-hours") ? Number(args.get("stale-hours")) : undefined;
if (run !== undefined && !RUN_ID_PATTERN.test(run)) fail("--run must be 3-40 lowercase letters, digits or dashes");
if (run === undefined && !(staleHours && staleHours >= 1)) fail("Give --run <id> or --stale-hours <n> (n >= 1)");

const { domain } = EMAIL_DOMAINS[on];
// Which users this cleanup is about. LIKE's "_" is a wildcard, but the tag
// can only contain [a-z0-9-] (checked above), so the patterns stay exact enough;
// the "e2e-" tag and the test domain are both required.
const anyRun = `"email" LIKE '%e2e-%@${domain}'`;
const selected = run
  ? `"email" LIKE '%e2e-${run}-%@${domain}'`
  : `${anyRun} AND "createdAt" < '${new Date(Date.now() - staleHours! * 3_600_000).toISOString()}'`;
const clientName = run ? `"name" LIKE 'e2e-${run}-%'` : `"name" LIKE 'e2e-%' AND "createdAt" < '${new Date(Date.now() - staleHours! * 3_600_000).toISOString()}'`;

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ids = (rows: Record<string, unknown>[], key: string) =>
  rows.map((r) => String(r[key])).filter((id) => {
    if (!ID.test(id)) fail(`Unexpected ID format: ${id}`);
    return true;
  });
const list = (values: string[]) => (values.length ? values.map((v) => `'${v}'`).join(", ") : "NULL");

console.log(`Cleaning up ${run ? `run ${run}` : `e2e data older than ${staleHours}h`} on ${on}…`);

const users = ids(d1(`SELECT "id" FROM "user" WHERE ${selected}`, on), "id");
const clients = d1(`SELECT "id", "clientId" FROM "oauthClient" WHERE ${clientName}`, on);
const clientIds = [...ids(clients, "id"), ...ids(clients, "clientId")];
const organizations = users.length
  ? ids(d1(`SELECT DISTINCT "organizationId" FROM "member" WHERE "userId" IN (${list(users)}) AND "role" = 'owner'`, on), "organizationId")
  : [];
const tenants = users.length ? ids(d1(`SELECT DISTINCT "tenantId" FROM "tenant_admin" WHERE "userId" IN (${list(users)})`, on), "tenantId") : [];

// Safety: never delete a company or tenant that holds anyone or anything that isn't from an e2e run.
if (organizations.length) {
  const outsiders = d1(
    `SELECT COUNT(*) AS n FROM "member" m JOIN "user" u ON u."id" = m."userId"
      WHERE m."organizationId" IN (${list(organizations)}) AND NOT (u.${anyRun})`,
    on,
  );
  if (Number(outsiders[0]?.n) > 0) fail(`A test company has ${outsiders[0].n} member(s) who aren't e2e users. Nothing was deleted; check by hand.`);
}
if (tenants.length) {
  const foreign = d1(`SELECT COUNT(*) AS n FROM "organization" WHERE "tenantId" IN (${list(tenants)}) AND "id" NOT IN (${list(organizations)})`, on);
  if (Number(foreign[0]?.n) > 0) fail("A test tenant owns a company that isn't a test company. Nothing was deleted; check by hand.");
}

console.log(`Found ${users.length} user(s), ${organizations.length} company(ies), ${tenants.length} tenant(s), ${clients.length} OAuth client(s).`);
if (!users.length && !clients.length) process.exit(0);

// Notes in KV, under each test company's prefix (org:<id>:user:<id>:note:<id>).
for (const organization of organizations) {
  const keys = (JSON.parse(kv(["key", "list", "--prefix", `org:${organization}:`], on)) as { name: string }[]).map((k) => k.name);
  if (!keys.length) continue;
  const dir = mkdtempSync(join(tmpdir(), "e2e-kv-"));
  writeFileSync(join(dir, "keys.json"), JSON.stringify(keys));
  kv(["bulk", "delete", join(dir, "keys.json"), "--force"], on);
  rmSync(dir, { recursive: true, force: true });
  console.log(`Deleted ${keys.length} note key(s) of company ${organization}.`);
}

// Every row in one request; foreign keys are checked at the end.
const U = list(users), O = list(organizations), T = list(tenants), C = list(clientIds);
const sql = `PRAGMA defer_foreign_keys = on;
DELETE FROM "org_member_role" WHERE "organizationId" IN (${O}) OR "userId" IN (${U});
DELETE FROM "org_role_permission" WHERE "roleId" IN (SELECT "id" FROM "org_role" WHERE "organizationId" IN (${O}));
DELETE FROM "org_role" WHERE "organizationId" IN (${O});
DELETE FROM "invitation" WHERE "organizationId" IN (${O}) OR "inviterId" IN (${U}) OR ${selected};
DELETE FROM "member" WHERE "organizationId" IN (${O}) OR "userId" IN (${U});
DELETE FROM "oauthAccessToken" WHERE "userId" IN (${U}) OR "clientId" IN (${C});
DELETE FROM "oauthRefreshToken" WHERE "userId" IN (${U}) OR "clientId" IN (${C});
DELETE FROM "oauthConsent" WHERE "userId" IN (${U}) OR "clientId" IN (${C});
DELETE FROM "oauthClientResource" WHERE "clientId" IN (${C});
DELETE FROM "oauthClient" WHERE "id" IN (${C});
DELETE FROM "session" WHERE "userId" IN (${U});
DELETE FROM "account" WHERE "userId" IN (${U});
DELETE FROM "organization" WHERE "id" IN (${O});
DELETE FROM "tenant_admin" WHERE "tenantId" IN (${T}) OR "userId" IN (${U});
DELETE FROM "tenant" WHERE "id" IN (${T});
DELETE FROM "user" WHERE "id" IN (${U});
`;
const dir = mkdtempSync(join(tmpdir(), "e2e-sql-"));
writeFileSync(join(dir, "cleanup.sql"), sql);
try {
  d1File(join(dir, "cleanup.sql"), on);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Check it worked.
const left = d1(
  `SELECT (SELECT COUNT(*) FROM "user" WHERE ${selected}) AS users,
          (SELECT COUNT(*) FROM "organization" WHERE "id" IN (${O})) AS organizations,
          (SELECT COUNT(*) FROM "oauthClient" WHERE ${clientName}) AS clients`,
  on,
)[0];
if (Number(left.users) || Number(left.organizations) || Number(left.clients)) fail(`Cleanup left rows behind: ${JSON.stringify(left)}`);
console.log("Cleanup done: nothing from this run is left.");

function fail(message: string): never {
  console.error(`cleanup: ${message}`);
  process.exit(1);
}
