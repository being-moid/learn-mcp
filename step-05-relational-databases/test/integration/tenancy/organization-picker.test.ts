import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addOrganization, BASE, createAccount, issueAccessToken, registerClient } from "../helpers/oauth";

const claims = (token: string) => JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const ORG_CLAIM = "https://stockroom.example/organization_id";

describe("choosing an organization when connecting", () => {
  it("doesn't ask a user with one organization", async () => {
    const account = await createAccount("Solo");
    const token = await issueAccessToken(account, await registerClient()); // fails if sent to the picker
    expect(claims(token)[ORG_CLAIM]).toBe(account.organizationId);
  });

  it("asks a user with several, and the token carries the one they chose", async () => {
    const account = await createAccount("Multi");
    const second = await addOrganization(account);
    const client = await registerClient();

    await expect(issueAccessToken(account, client)).rejects.toThrow(/organization picker/);
    expect(claims(await issueAccessToken(account, client, second))[ORG_CLAIM]).toBe(second);
    expect(claims(await issueAccessToken(account, client, account.organizationId))[ORG_CLAIM]).toBe(account.organizationId);
  });

  it("refuses to pick an organization the user doesn't belong to", async () => {
    const outsider = await createAccount("Outsider");
    const other = await createAccount("Other");
    await addOrganization(outsider);
    await expect(issueAccessToken(outsider, await registerClient(), other.organizationId)).rejects.toThrow(/set active organization failed/);
  });

  it("serves the picker page with the same security headers as the others", async () => {
    const res = await exports.default.fetch(`${BASE}/select-organization`, { headers: { host: new URL(BASE).host } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
