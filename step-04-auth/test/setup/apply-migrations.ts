import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

// Brings the test runtime's empty D1 up to date with migrations/, the same
// files `wrangler d1 migrations apply` uses. Already-applied migrations are
// skipped, so this is cheap to run before every test file.
const bindings = env as unknown as { AUTH_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(bindings.AUTH_DB, bindings.TEST_MIGRATIONS);
