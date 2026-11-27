import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { readAuthSecret, type AuthSecretBindings } from "../../../../src/infrastructure/auth/auth-secret";

// In the Workers test runtime the store is empty, and the Vitest config's
// test-only binding provides the secret instead.
it("gets Better Auth's secret in the test runtime from the test-only binding", async () => {
  const secret = await readAuthSecret(env as unknown as AuthSecretBindings);
  expect(secret).toBe("test-only-secret-for-vitest-never-used-in-production-0001");
});
