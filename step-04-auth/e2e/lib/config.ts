import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// End-to-end tests run over real HTTPS against a deployed Worker: staging on
// every pull request, production after a merge. Everything they create is
// tagged with the run's ID (in every email address, user name and OAuth
// client name), so cleanup can delete exactly that and nothing else.
//
// Settings come from environment variables (set by the GitHub workflow):
//   E2E_TARGET       "staging" or "production"
//   E2E_RUN_ID       lowercase letters, digits and dashes; unique per run
//   E2E_BASE_URL     optional; defaults to the target's workers.dev address
//   E2E_INVITATION_SECRET  staging only: the staging auth secret, so tests
//                    can build invitation links (the emailed ones are only logged)

export type Target = "staging" | "production";

export const STEP_DIR = fileURLToPath(new URL("../..", import.meta.url).href);

const BASE_URLS: Record<Target, string> = {
  staging: "https://learn-mcp-step-04-staging.stockroom-mms.workers.dev",
  production: "https://learn-mcp-step-04.stockroom-mms.workers.dev",
};

/**
 * Test email domains. Staging sends no email, so any reserved domain works.
 * Production really sends (sign-up confirmations, invitations), so it uses
 * Resend's test inbox, which accepts labels and never harms the domain's
 * reputation: https://resend.com/docs/dashboard/emails/send-test-emails
 */
export const EMAIL_DOMAINS: Record<Target, { prefix: string; domain: string }> = {
  staging: { prefix: "", domain: "e2e.example.com" },
  production: { prefix: "delivered+", domain: "resend.dev" },
};

export const RUN_ID_PATTERN = /^[a-z0-9-]{3,40}$/;

export function target(): Target {
  const value = process.env.E2E_TARGET ?? "staging";
  if (value !== "staging" && value !== "production") throw new Error(`E2E_TARGET must be "staging" or "production", not "${value}"`);
  return value;
}

export function runId(): string {
  const value = process.env.E2E_RUN_ID ?? "";
  if (!RUN_ID_PATTERN.test(value)) throw new Error("E2E_RUN_ID must be 3-40 lowercase letters, digits or dashes (the workflow sets it)");
  return value;
}

export function baseUrl(): string {
  return (process.env.E2E_BASE_URL ?? BASE_URLS[target()]).replace(/\/+$/, "");
}

/** The tag in everything a run creates: `e2e-<run>-`. */
export function tag(run = runId()): string {
  return `e2e-${run}-`;
}

/** A tagged test email address for this run, e.g. delivered+e2e-123-owner-a@resend.dev. */
export function testEmail(label: string): string {
  const { prefix, domain } = EMAIL_DOMAINS[target()];
  return `${prefix}${tag()}${label}@${domain}`.toLowerCase();
}

/** The staging auth secret (CI: env var; locally: the git-ignored file next to wrangler.jsonc). */
export function invitationSecret(): string | undefined {
  if (process.env.E2E_INVITATION_SECRET) return process.env.E2E_INVITATION_SECRET;
  const file = `${STEP_DIR}/.env.staging-auth-secret`;
  return target() === "staging" && existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
}
