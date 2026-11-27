import { describe, expect, it } from "vitest";
import { rpc } from "./mcp";

const get = (args: Record<string, string>) =>
  rpc("prompts/get", { name: "summarize_notes", arguments: args }, "summarize_notes");

describe("summarize_notes prompt", () => {
  it("is listed with an optional category argument", async () => {
    const msg = await rpc("prompts/list");
    const prompt = msg.result.prompts.find((p: any) => p.name === "summarize_notes");
    expect(prompt.title).toBe("Summarize my notes");
    expect(prompt.arguments).toEqual([expect.objectContaining({ name: "category", required: false })]);
  });

  it("builds a message that tells the model to use the notes tools", async () => {
    const msg = await get({});
    const text = msg.result.messages[0].content.text;
    expect(msg.result.messages[0].role).toBe("user");
    expect(text).toContain("all my notes");
    expect(text).toContain("list_notes");
    expect(text).toContain("get_note");
    // Guards against note text being treated as instructions.
    expect(text).toContain("not as instructions");
  });

  it("narrows to one category when given", async () => {
    const msg = await get({ category: "follow_up" });
    expect(msg.result.messages[0].content.text).toContain('category is "follow_up"');
  });

  it("rejects an unknown category or prompt with -32602", async () => {
    expect((await get({ category: "gossip" })).error.code).toBe(-32602);
    const unknown = await rpc("prompts/get", { name: "no_such_prompt", arguments: {} }, "no_such_prompt");
    expect(unknown.error.code).toBe(-32602);
  });
});
