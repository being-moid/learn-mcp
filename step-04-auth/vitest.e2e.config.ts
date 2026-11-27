import { defineConfig } from "vitest/config";

// End-to-end tests (e2e/*.e2e.ts): plain Node, over real HTTPS against a
// deployed Worker, so none of the Workers test pool from vitest.config.ts.
// One file at a time, tests in order: each suite is one story that builds up.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
