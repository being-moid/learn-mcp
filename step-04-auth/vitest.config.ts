import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The D1 migrations in migrations/, applied to the test runtime's empty D1
// before the tests run (see test/setup/apply-migrations.ts).
const migrations = await readD1Migrations("./migrations");

// Run the tests inside the real Workers runtime (workerd), using this step's
// wrangler config, so the test exercises the same code that gets deployed.
export default defineConfig({
  test: { setupFiles: ["./test/setup/apply-migrations.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The workerd bundled with the test pool lags behind the deployed runtime
      // and only knows dates up to 2026-08-22, so tests pin that date. It is
      // still after 2026-08-04, so Node.js compatibility stays on. Deploys use
      // the date in wrangler.jsonc.
      miniflare: {
        compatibilityDate: "2026-08-22",
        bindings: {
          // The local Secrets Store is empty in tests, so Better Auth's secret
          // comes from this test-only binding (see src/infrastructure/auth/auth-secret.ts).
          // A throwaway value used nowhere else; wrangler.jsonc never defines it.
          AUTH_SECRET_FOR_TESTS: "test-only-secret-for-vitest-never-used-in-production-0001",
          TEST_MIGRATIONS: migrations,
          // Tests record emails instead of sending them through Resend
          // (see src/infrastructure/email/recording-email-sender.ts).
          EMAIL_SENDER_FOR_TESTS: "record",
          // Links in relayed emails point at the test server's address.
          PUBLIC_URL: "https://learn-mcp-step-04.example.workers.dev",
        },
      },
    }),
  ],
});
