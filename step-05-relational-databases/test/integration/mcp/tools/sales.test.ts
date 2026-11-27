import { describe, expect, it } from "vitest";
import { callTool, rpc } from "../../helpers/mcp";
import { addMember, createAccount, issueAccessToken, registerClient } from "../../helpers/oauth";

// The sales tools' contracts, with the database replaced by a fixed stand-in
// (DATABASE_FOR_TESTS in vitest.config.ts). The SQL itself is tested against
// a real Neon branch by `npm run test:db`.

describe("sales tools", () => {
  it("are listed, read-only, and take no SQL, table or company", async () => {
    const { tools } = (await rpc("tools/list", {})).result;
    for (const name of ["describe_schema", "answer_business_question", "compare_designs"]) {
      const tool = tools.find((t: { name: string }) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool.annotations.readOnlyHint, name).toBe(true);
      const inputs = Object.keys(tool.inputSchema.properties ?? {});
      expect(inputs.filter((k) => /sql|query|table|org|company/i.test(k)), name).toEqual([]);
    }
  });

  it("answers for the caller's company, which comes from the token", async () => {
    const account = await createAccount("Sales");
    const token = await issueAccessToken(account, await registerClient());
    const result = await callTool("answer_business_question", { question: "top_products", limit: 3 }, token);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.rows[0]).toMatchObject({ organization: account.organizationId, limit: 3 });
  });

  it("refuses a question outside the list, and asks for the customer when customer_orders needs one", async () => {
    expect((await callTool("answer_business_question", { question: "drop_tables" })).isError).toBe(true);
    const missing = await callTool("answer_business_question", { question: "customer_orders" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("customer_orders needs `customer`");
    const backwards = await callTool("answer_business_question", { question: "monthly_revenue", from: "2026-06-01", to: "2026-01-01" });
    expect(backwards.content[0].text).toContain("Swap them");
    expect((await callTool("answer_business_question", { question: "monthly_revenue", from: "June" })).isError).toBe(true);
  });

  it("compare_designs reports the differences in words", async () => {
    const result = await callTool("compare_designs", { comparison: "customer_contacts" });
    expect(result.structuredContent.differences[0]).toBe(
      "Corner Market: the spreadsheet has 2 different cities (Austin | Round Rock); the normalized design stores one (Round Rock).",
    );
  });

  it("describe_schema returns the structure", async () => {
    const result = await callTool("describe_schema", {});
    expect(result.structuredContent.tables[0].constraints[0].definition).toBe("PRIMARY KEY (org_id, order_id)");
  });

  it("refuses a role without sales:read", async () => {
    const owner = await createAccount("SalesOwner");
    const client = await registerClient();
    const ownerToken = await issueAccessToken(owner, client);
    const member = await addMember(owner, "NoSales");
    const memberToken = await issueAccessToken(member, client, owner.organizationId);
    const role = await callTool("create_role", { name: "Directory", permissions: ["members:read"] }, ownerToken);
    await callTool("assign_member_role", { userId: member.userId, roleId: role.structuredContent.id }, ownerToken);
    for (const [name, args] of [["describe_schema", {}], ["answer_business_question", { question: "monthly_revenue" }], ["compare_designs", { comparison: "total_revenue" }]] as const) {
      const refused = await callTool(name, args, memberToken);
      expect(refused.isError, name).toBe(true);
      expect(refused.content[0].text, name).toContain('"sales:read" permission');
    }
  });
});
