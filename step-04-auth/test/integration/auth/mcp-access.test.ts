import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool, rpc } from "../helpers/mcp";
import { BASE, createAccount, issueAccessToken, MCP_URL, registerClient } from "../helpers/oauth";

// Who may call /mcp: a valid token for this server, for an organization the
// caller still belongs to.

const toolsList = (headers: Record<string, string>, url = MCP_URL) =>
  exports.default.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      host: new URL(url).host,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

async function accountWithToken(name: string) {
  const account = await createAccount(name);
  return { account, token: await issueAccessToken(account, await registerClient()) };
}

describe("/mcp requires a valid access token", () => {
  it("answers no token with 401 and points to the protected-resource metadata", async () => {
    const res = await toolsList({});
    expect(res.status).toBe(401);
    // This header is how Claude and ChatGPT find our sign-in.
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource`);
  });

  it("refuses a token that isn't one of ours", async () => {
    const res = await toolsList({ authorization: "Bearer not.a.real.token" });
    expect(res.status).toBe(401);
  });

  it("refuses a token issued for a different server (audience check)", async () => {
    // A genuine token, but minted for this Worker's /mcp, presented to another
    // deployment's /mcp: its audience doesn't match, so it must be refused.
    const { token } = await accountWithToken("Audience");
    const other = "https://some-other-server.example.workers.dev/mcp";
    const res = await toolsList({ authorization: `Bearer ${token}` }, other);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token for a member", async () => {
    const { token } = await accountWithToken("Member");
    const res = await toolsList({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("list_notes");
  });
});

describe("membership is checked on every request", () => {
  it("refuses a removed member on their next call, even with an unexpired token", async () => {
    const { account, token } = await accountWithToken("Removed");
    expect((await toolsList({ authorization: `Bearer ${token}` })).status).toBe(200);

    // Simulates an admin removing them from the organization.
    await env.AUTH_DB.prepare('DELETE FROM "member" WHERE "userId" = ? AND "organizationId" = ?')
      .bind(account.userId, account.organizationId)
      .run();

    const res = await toolsList({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_a_member");
  });

  it("refuses a token that names no organization", async () => {
    // A user who signed in without an active organization gets a token with
    // no organization claim; it can't be used for /mcp.
    const account = await createAccount("NoOrg");
    await env.AUTH_DB.prepare('UPDATE "session" SET "activeOrganizationId" = NULL WHERE "userId" = ?').bind(account.userId).run();
    const token = await issueAccessToken(account, await registerClient());
    const res = await toolsList({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("no_organization");
  });
});

describe("each user sees only their own notes", () => {
  it("keeps one user's note away from another user's tools and resources", async () => {
    const alice = await accountWithToken("Alice");
    const bob = await accountWithToken("Bob");
    const created = await callTool("create_note", { title: "Alice's call", body: "Private" }, alice.token);
    const id = created.structuredContent.id;

    const bobsList = await callTool("list_notes", {}, bob.token);
    expect(bobsList.structuredContent.notes.map((n: { id: string }) => n.id)).not.toContain(id);
    expect((await callTool("get_note", { id }, bob.token)).isError).toBe(true);
    expect((await callTool("delete_note", { id }, bob.token)).isError).toBe(true);
    expect((await rpc("resources/read", { uri: `note://${id}` }, `note://${id}`, bob.token)).error.code).toBe(-32602);

    // Bob's attempts changed nothing for Alice.
    expect((await callTool("get_note", { id }, alice.token)).structuredContent.title).toBe("Alice's call");
  });
});
