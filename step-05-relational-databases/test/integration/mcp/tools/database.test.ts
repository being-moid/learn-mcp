import { describe, expect, it } from "vitest";
import { callTool } from "../../helpers/mcp";

// The Neon connection is replaced by a fixed stand-in in these tests
// (DATABASE_FOR_TESTS in vitest.config.ts); this checks the tool's contract.
describe("database_status", () => {
  it("reports the connection and the applied migrations", async () => {
    const result = await callTool("database_status", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      connected: true,
      migrations: [{ name: "0001_test.sql", appliedAt: "2026-11-28T00:00:00.000Z" }],
    });
    expect(result.content[0].text).toContain("0001_test.sql");
  });
});
