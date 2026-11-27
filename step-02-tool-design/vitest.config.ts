import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Run the tests inside the real Workers runtime (workerd), using this step's
// wrangler config, so the test exercises the same code that gets deployed.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The workerd bundled with the test pool lags behind the deployed runtime
      // and only knows dates up to 2026-08-22, so tests pin that date. It is
      // still after 2026-08-04, so Node.js compatibility stays on. Deploys use
      // the date in wrangler.jsonc.
      miniflare: { compatibilityDate: "2026-08-22" },
    }),
  ],
});
