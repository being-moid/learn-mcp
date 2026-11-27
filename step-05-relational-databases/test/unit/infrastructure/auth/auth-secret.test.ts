import { describe, expect, it } from "vitest";
import { readAuthSecret, type AuthSecretBindings } from "../../../../src/infrastructure/auth/auth-secret";

const LONG = "x".repeat(44);
const store = (get: () => Promise<string>): AuthSecretBindings["BETTER_AUTH_SECRET"] => ({ get });

describe("readAuthSecret", () => {
  it("reads the secret from the Secrets Store", async () => {
    expect(await readAuthSecret({ BETTER_AUTH_SECRET: store(async () => LONG) })).toBe(LONG);
  });

  it("uses the test-only binding when present, without touching the store", async () => {
    let storeRead = false;
    const secret = await readAuthSecret({
      BETTER_AUTH_SECRET: store(async () => {
        storeRead = true;
        return LONG;
      }),
      AUTH_SECRET_FOR_TESTS: "t".repeat(40),
    });
    expect(secret).toBe("t".repeat(40));
    expect(storeRead).toBe(false);
  });

  it("explains how to create the secret when the store doesn't have it", async () => {
    const missing = store(async () => {
      throw new Error('Secret "BETTER_AUTH_SECRET_STEP_05" not found');
    });
    await expect(readAuthSecret({ BETTER_AUTH_SECRET: missing })).rejects.toThrow(/secrets-store secret create/);
  });

  it("refuses a short secret", async () => {
    await expect(readAuthSecret({ BETTER_AUTH_SECRET: store(async () => "too-short") })).rejects.toThrow(/at least 32/);
  });
});
