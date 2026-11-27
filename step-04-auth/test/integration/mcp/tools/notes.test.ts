import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool } from "../../helpers/mcp";

describe("notes tools", () => {
  it("creates, reads, lists and deletes a note", async () => {
    const created = await callTool("create_note", {
      title: "Call with Ali at Karachi Foods",
      body: "Wants a price list on Friday.",
      category: "call",
    });
    expect(created.isError).toBeFalsy();
    const id = created.structuredContent.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const read = await callTool("get_note", { id });
    expect(read.structuredContent.body).toBe("Wants a price list on Friday.");

    const listed = await callTool("list_notes", {});
    expect(listed.structuredContent.notes.map((n: any) => n.id)).toContain(id);

    const deleted = await callTool("delete_note", { id });
    expect(deleted.structuredContent).toEqual({ id, deleted: true });

    // After deleting, both read and delete return recoverable errors.
    const missing = await callTool("get_note", { id });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("list_notes");
    const again = await callTool("delete_note", { id });
    expect(again.isError).toBe(true);
  });

  it("defaults the category to other", async () => {
    const created = await callTool("create_note", { title: "Misc", body: "Something." });
    expect(created.structuredContent.category).toBe("other");
  });

  it("answers bad input with a recoverable error naming the field", async () => {
    for (const [tool, args, field] of [
      ["get_note", { id: "Karachi Foods" }, "id"],
      ["get_note", {}, "id"],
      ["create_note", { title: "", body: "x" }, "title"],
      ["create_note", { title: "t", body: "x", category: "gossip" }, "category"],
      ["list_notes", { limit: 500 }, "limit"],
    ] as const) {
      const result = await callTool(tool, args);
      expect(result.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
      expect(result.content[0].text).toContain(`${field}:`);
    }
  });

  it("doesn't claim there are no notes when only a cursor page is empty", async () => {
    await callTool("create_note", { title: "Exists", body: "x" });
    const result = await callTool("list_notes", { cursor: "not-a-real-cursor" });
    expect(result.content[0].text).not.toContain("no notes yet");
    expect(result.content[0].text).toContain("without a cursor");
  });

  it("explains a missing note, including the KV delay", async () => {
    const result = await callTool("get_note", { id: crypto.randomUUID() });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/list_notes.*last minute/s);
  });

  it("rejects an unknown tool at the protocol level", async () => {
    await expect(callTool("no_such_tool", {})).rejects.toThrow(/-32602/);
  });
});

describe("when KV fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a short recoverable error instead of throwing", async () => {
    vi.spyOn(env.NOTES, "get").mockRejectedValue(new Error("KV GET failed: 503 internal detail"));
    const result = await callTool("get_note", { id: crypto.randomUUID() });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("temporarily unavailable");
    expect(result.content[0].text).not.toContain("internal detail");
  });

  it("tells the model to check before retrying a failed create", async () => {
    vi.spyOn(env.NOTES, "put").mockRejectedValue(new Error("KV PUT failed"));
    const result = await callTool("create_note", { title: "t", body: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("call list_notes to check");
  });
});

describe("stateless /mcp", () => {
  it("answers 20 concurrent create_note calls, each with its own note", async () => {
    const titles = Array.from({ length: 20 }, (_, i) => `Customer note ${i + 1}`);
    const results = await Promise.all(titles.map((title) => callTool("create_note", { title, body: `Body for ${title}` })));
    results.forEach((r, i) => {
      expect(r.structuredContent.title).toBe(titles[i]);
      expect(r.structuredContent.body).toBe(`Body for ${titles[i]}`);
    });
    expect(new Set(results.map((r) => r.structuredContent.id)).size).toBe(20);
  });

  it("returns 404 outside /mcp", async () => {
    const { exports } = await import("cloudflare:workers");
    const res = await exports.default.fetch("https://example.com/");
    expect(res.status).toBe(404);
  });
});
