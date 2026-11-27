// Connects a Node script (the migration runner, the SQL runner) to one Neon
// branch. The connection string is fetched for the branch with the Neon CLI
// (signed in once with `npx neonctl auth`), so it is never typed or stored:
// it lives only in this process's memory. DATABASE_URL, if set, is used instead.
// The production branch is refused: this step never touches it.

import { execFileSync } from "node:child_process";
import { Client, neonConfig, types } from "@neondatabase/serverless";

// The Neon project, database and role for this bootcamp. Names and IDs, not secrets.
const NEON_PROJECT_ID = "plain-sunset-81517557";
const NEON_DATABASE = "neondb";
const NEON_ROLE = "neondb_owner";
const REFUSED_BRANCHES = new Set(["production", "main"]);

// Node 24 has a WebSocket built in; the driver's Client talks to Neon over it,
// which (unlike the HTTP query function the Worker uses) supports transactions.
neonConfig.webSocketConstructor = WebSocket;

// A Postgres `date` has no time zone, but the driver turns it into a JS Date
// at local midnight, which prints as the day before in UTC. Keep it as the
// text Postgres sends ("2026-03-12"). 1082 is the type ID of `date`.
types.setTypeParser(1082, (value: string) => value);

/** Reads `--branch <name>` (and other `--flag value` pairs) from the command line. */
export function parseArgs(argv: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--status") flags.set("status", "true");
    else if (arg.startsWith("--")) flags.set(arg.slice(2), argv[++i] ?? "");
    else positional.push(arg);
  }
  return { flags, positional };
}

/** A connected Client for the branch; call client.end() when done. */
export async function connectToBranch(branch: string | undefined): Promise<Client> {
  const client = new Client(connectionString(branch));
  await client.connect();
  return client;
}

function connectionString(branch: string | undefined): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!branch) fail("Say which Neon branch to use: --branch dev (or --branch step-05).");
  if (REFUSED_BRANCHES.has(branch)) fail(`Refusing to touch the ${branch} branch. Step 05 uses its own branches: step-05 and dev.`);
  try {
    return execFileSync(
      "npx",
      ["--no-install", "neonctl", "connection-string", branch, "--project-id", NEON_PROJECT_ID, "--database-name", NEON_DATABASE, "--role-name", NEON_ROLE],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
  } catch {
    fail(`Couldn't get the connection string for branch "${branch}". Is it spelled right, and are you signed in (npx neonctl auth)?`);
  }
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
