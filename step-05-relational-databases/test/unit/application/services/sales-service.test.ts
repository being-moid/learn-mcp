import { describe, expect, it } from "vitest";
import { differences } from "../../../../src/application/services/sales-service";

describe("differences (compare_designs)", () => {
  it("says what the spreadsheet left out, and which keys and values differ", () => {
    const found = differences(
      [{ key: "Snacks", values: { revenue: 100 } }, { key: "Austin", values: { revenue: 40 } }],
      [{ key: "Snacks", values: { revenue: 120 } }, { key: "Round Rock", values: { revenue: 60 } }],
      7,
    );
    expect(found).toEqual([
      "The spreadsheet query had to leave out 7 row(s) whose cells hold two products, two prices and two quantities (they can't be summed), so its totals are missing those sales.",
      "Snacks: revenue is 100 in the spreadsheet but 120 in the normalized tables.",
      '"Austin" appears only in the spreadsheet: revenue 40.',
      '"Round Rock" appears only in the normalized tables: revenue 60.',
    ]);
  });

  it("says when both agree, and when the company has nothing to compare", () => {
    expect(differences([{ key: "a", values: { n: 1 } }], [{ key: "a", values: { n: 1 } }], 0)).toEqual(["Both designs give the same answer to this question."]);
    expect(differences([{ key: "a", values: { n: 1 } }], [], 0)[0]).toMatch(/no sales in the normalized tables/);
  });
});
