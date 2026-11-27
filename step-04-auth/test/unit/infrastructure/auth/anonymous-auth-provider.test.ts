import { describe, expect, it } from "vitest";
import { ANONYMOUS } from "../../../../src/domain/entities/principal";
import { AnonymousAuthProvider } from "../../../../src/infrastructure/auth/anonymous-auth-provider";

describe("AnonymousAuthProvider", () => {
  const provider = new AnonymousAuthProvider();

  it("lets every request through as the anonymous principal", async () => {
    expect(await provider.authenticate()).toEqual({ ok: true, principal: ANONYMOUS });
  });

  it("owns no routes", async () => {
    expect(await provider.handleRoute()).toBeUndefined();
  });
});
