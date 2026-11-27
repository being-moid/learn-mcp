import { describe, expect, it } from "vitest";
import { callerFromAuthInfo, callerToAuthInfo, type Caller } from "../../../src/presentation/mcp/auth-info";
import { membership } from "../../fakes/memberships";

describe("auth-info", () => {
  it("carries the caller through the SDK's authInfo unchanged", () => {
    const caller: Caller = { principal: { kind: "user", userId: "u1", organizationId: "o1" }, membership: membership("u1", "o1", "owner") };
    expect(callerFromAuthInfo(callerToAuthInfo(caller))).toEqual(caller);
  });

  it("fails closed when a request arrives without an authenticated, checked caller", () => {
    expect(() => callerFromAuthInfo(undefined)).toThrow(/without an authenticated, checked caller/);
    expect(() => callerFromAuthInfo({ token: "", clientId: "x", scopes: [] })).toThrow();
  });
});
