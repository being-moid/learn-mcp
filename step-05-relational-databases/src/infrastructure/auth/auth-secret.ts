// Reads Better Auth's signing secret.
//
// Production: from the account's Cloudflare Secrets Store, through the
// BETTER_AUTH_SECRET binding in wrangler.jsonc (secret name
// BETTER_AUTH_SECRET_STEP_04). The value never appears in code or config.
//
// Tests: the local Secrets Store is empty in the Vitest runtime, so the
// Vitest config (and only it) defines a plain AUTH_SECRET_FOR_TESTS binding
// with a throwaway value. wrangler.jsonc never defines it, so in production
// the store is always used.
//
// `wrangler dev` reads a local store secret, seeded once with
//   npx wrangler secrets-store secret create <store-id> --name BETTER_AUTH_SECRET_STEP_04 --scopes workers

/** The bindings this reader needs; passed in so it can be unit-tested. */
export interface AuthSecretBindings {
  BETTER_AUTH_SECRET: { get(): Promise<string> };
  AUTH_SECRET_FOR_TESTS?: string;
}

/** Better Auth recommends a long random secret; refuse anything short. */
export const MIN_SECRET_LENGTH = 32;

export async function readAuthSecret(bindings: AuthSecretBindings): Promise<string> {
  const secret = bindings.AUTH_SECRET_FOR_TESTS ?? (await readFromStore(bindings));
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Better Auth's secret must be at least ${MIN_SECRET_LENGTH} characters; generate one with: openssl rand -base64 32`);
  }
  return secret;
}

async function readFromStore(bindings: AuthSecretBindings): Promise<string> {
  try {
    return await bindings.BETTER_AUTH_SECRET.get();
  } catch (err) {
    // Say what to do, not just "not found". The original error is kept as the cause.
    throw new Error(
      "Better Auth's secret BETTER_AUTH_SECRET_STEP_04 is missing from the Cloudflare Secrets Store. " +
        "Create it with: npx wrangler secrets-store secret create <store-id> --name BETTER_AUTH_SECRET_STEP_04 --scopes workers " +
        "(add --remote for the deployed Worker).",
      { cause: err },
    );
  }
}
