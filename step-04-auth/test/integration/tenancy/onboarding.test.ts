import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool } from "../helpers/mcp";
import { createAccount, issueAccessToken, registerClient } from "../helpers/oauth";

const db = () => env.AUTH_DB;

describe("onboarding on sign-up", () => {
  it("creates the tenant, the organization, the Owner membership and the default roles", async () => {
    const account = await createAccount("Ayesha");

    const organization = await db().prepare('SELECT "name", "tenantId" FROM "organization" WHERE "id" = ?').bind(account.organizationId).first<{ name: string; tenantId: string }>();
    expect(organization?.name).toBe("Ayesha's company");
    expect(organization?.tenantId).toBeTruthy();

    const tenant = await db().prepare('SELECT "name" FROM "tenant" WHERE "id" = ?').bind(organization!.tenantId).first<{ name: string }>();
    expect(tenant?.name).toBe("Ayesha's account");
    const admin = await db().prepare('SELECT "level" FROM "tenant_admin" WHERE "tenantId" = ? AND "userId" = ?').bind(organization!.tenantId, account.userId).first();
    expect(admin).toEqual({ level: "owner" });

    const member = await db().prepare('SELECT "role" FROM "member" WHERE "userId" = ? AND "organizationId" = ?').bind(account.userId, account.organizationId).first();
    expect(member).toEqual({ role: "owner" });

    const roles = await db()
      .prepare(
        `SELECT r."builtin" AS builtin, r."name" AS name, count(p."permission") AS permissions
           FROM "org_role" r LEFT JOIN "org_role_permission" p ON p."roleId" = r."id"
          WHERE r."organizationId" = ? GROUP BY r."id" ORDER BY r."builtin"`,
      )
      .bind(account.organizationId)
      .all();
    expect(roles.results).toEqual([
      { builtin: "admin", name: "Admin", permissions: 7 },
      { builtin: "member", name: "Member", permissions: 3 },
      { builtin: "owner", name: "Owner", permissions: 7 },
    ]);
  });

  it("starts the new user's session on their organization", async () => {
    const account = await createAccount("Ali");
    const session = await db().prepare('SELECT "activeOrganizationId" FROM "session" WHERE "userId" = ?').bind(account.userId).first();
    expect(session).toEqual({ activeOrganizationId: account.organizationId });
  });

  it("lets a brand-new user connect and use the tools with no other setup", async () => {
    const account = await createAccount("Sara");
    const token = await issueAccessToken(account, await registerClient());
    const created = await callTool("create_note", { title: "First note", body: "Hello" }, token);
    expect(created.isError).toBeFalsy();
  });
});
