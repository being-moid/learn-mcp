import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// The connection to the business database: Neon Postgres, over HTTPS.
//
// Why @neondatabase/serverless: Workers can't open the raw TCP socket a
// classic Postgres driver uses without extra setup, and Neon's driver sends
// each query as one HTTPS request instead (`neon()`), which suits a Worker
// that runs a few read queries per request and keeps no connection between
// requests. (Step 06 moves to Hyperdrive, which pools real connections.)
//
// The connection string comes from the account's Cloudflare Secrets Store
// (secret NEON_CONNECTION_STRING, bound as NEON_DATABASE_URL in
// wrangler.jsonc), so it is never in code, config or git. It points at this
// step's Neon branch, step-05. `wrangler dev` reads the local store; seed it
// once with the dev branch's string:
//   npx wrangler secrets-store secret create <store-id> --name NEON_CONNECTION_STRING --scopes workers

export interface NeonBindings {
  NEON_DATABASE_URL: { get(): Promise<string> };
}

/** A query function for this request (cheap: it holds no connection). */
export async function neonSql(bindings: NeonBindings): Promise<NeonQueryFunction<false, false>> {
  return neon(await readConnectionString(bindings));
}

async function readConnectionString(bindings: NeonBindings): Promise<string> {
  try {
    return await bindings.NEON_DATABASE_URL.get();
  } catch (err) {
    // Say what to do, not just "not found". The original error is kept as the cause.
    throw new Error(
      "The Neon connection string NEON_CONNECTION_STRING is missing from the Cloudflare Secrets Store. " +
        "Create it with: npx wrangler secrets-store secret create <store-id> --name NEON_CONNECTION_STRING --scopes workers " +
        "(add --remote for the deployed Worker).",
      { cause: err },
    );
  }
}
