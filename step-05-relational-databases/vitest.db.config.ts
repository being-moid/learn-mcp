import { defineConfig } from "vitest/config";

// The database tests: the sales SQL run for real against a Neon branch
// (default dev; set NEON_BRANCH to change it), from Node. The Workers-runtime
// tests (vitest.config.ts) can't reach a database, so this is where the
// queries themselves are checked. Run with: npm run test:db
export default defineConfig({
  test: {
    include: ["test-db/**/*.db.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
