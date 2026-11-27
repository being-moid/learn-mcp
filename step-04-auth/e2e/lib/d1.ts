import { execFileSync } from "node:child_process";
import { STEP_DIR, target, type Target } from "./config.ts";

// Direct access to the target's D1 database through Wrangler (it uses
// CLOUDFLARE_API_TOKEN in CI, or your `wrangler login` locally). Only for
// what a browser can't do in a test: confirming a test user's email (the
// confirmation email goes to a test inbox nobody reads) and cleanup.
//
// Wrangler can't bind parameters, so callers only ever pass values they
// built themselves and checked against strict patterns.

export function d1(sql: string, on: Target = target()): Record<string, unknown>[] {
  const args = ["wrangler", "d1", "execute", "AUTH_DB", "--remote", "--json", "--command", sql];
  if (on === "staging") args.push("--env", "staging");
  const out = execFileSync("npx", args, { cwd: STEP_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
  const parsed = JSON.parse(out) as { results: Record<string, unknown>[] }[];
  return parsed.flatMap((r) => r.results ?? []);
}

/** Runs a file of SQL statements (in one request). */
export function d1File(path: string, on: Target = target()): void {
  const args = ["wrangler", "d1", "execute", "AUTH_DB", "--remote", "--file", path];
  if (on === "staging") args.push("--env", "staging");
  execFileSync("npx", args, { cwd: STEP_DIR, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, CI: "1" } });
}

/** Wrangler KV commands on the target's NOTES namespace. */
export function kv(args: string[], on: Target = target()): string {
  const full = ["wrangler", "kv", ...args, "--binding", "NOTES", "--remote"];
  if (on === "staging") full.push("--env", "staging");
  return execFileSync("npx", full, { cwd: STEP_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
}

const SAFE_EMAIL = /^[a-z0-9+._-]+@[a-z0-9.-]+$/;

/** Marks a test user's email as confirmed, as clicking the emailed link would. */
export function confirmEmail(email: string): void {
  if (!SAFE_EMAIL.test(email) || !email.includes("e2e-")) throw new Error(`Refusing to confirm a non-test address: ${email}`);
  d1(`UPDATE "user" SET "emailVerified" = 1 WHERE "email" = '${email}'`);
}
