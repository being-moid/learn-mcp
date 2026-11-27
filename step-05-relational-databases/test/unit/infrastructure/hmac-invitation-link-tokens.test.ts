import { describe, expect, it } from "vitest";
import { HmacInvitationLinkTokens } from "../../../src/infrastructure/auth/hmac-invitation-link-tokens";

const tokens = (secret = "a-long-test-secret-for-hmac-tokens-0001") => new HmacInvitationLinkTokens(async () => secret);

describe("HmacInvitationLinkTokens", () => {
  it("gives the same URL-safe token for the same invitation, and accepts it", async () => {
    const t = tokens();
    const token = await t.tokenFor("inv-1");
    expect(token).toBe(await t.tokenFor("inv-1"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await t.matches("inv-1", token)).toBe(true);
  });

  it("refuses another invitation's token, a changed token and junk", async () => {
    const t = tokens();
    const token = await t.tokenFor("inv-1");
    expect(await t.matches("inv-2", token)).toBe(false);
    expect(await t.matches("inv-1", (token[0] === "A" ? "B" : "A") + token.slice(1))).toBe(false);
    for (const junk of ["", "inv-1", "not base64!", "x".repeat(500)]) expect(await t.matches("inv-1", junk)).toBe(false);
  });

  it("can't be made without the server's secret", async () => {
    const forged = await tokens("someone-elses-secret-that-is-long-enough").tokenFor("inv-1");
    expect(await tokens().matches("inv-1", forged)).toBe(false);
  });
});
