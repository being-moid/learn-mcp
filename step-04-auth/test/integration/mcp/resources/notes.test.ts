import { describe, expect, it } from "vitest";
import { callTool, rpc } from "../../helpers/mcp";

describe("note:// resources", () => {
  it("lists the note://{id} template", async () => {
    const msg = await rpc("resources/templates/list");
    expect(msg.result.resourceTemplates.map((t: any) => t.uriTemplate)).toContain("note://{id}");
  });

  it("lists a new note as a resource and reads its text", async () => {
    const created = await callTool("create_note", { title: "Call with Ali", body: "Wants a price list.", category: "call" });
    const uri = `note://${created.structuredContent.id}`;

    const list = await rpc("resources/list");
    const entry = list.result.resources.find((r: any) => r.uri === uri);
    expect(entry).toMatchObject({ title: "Call with Ali", mimeType: "text/markdown" });

    const read = await rpc("resources/read", { uri }, uri);
    expect(read.result.contents[0].uri).toBe(uri);
    expect(read.result.contents[0].text).toContain("# Call with Ali");
    expect(read.result.contents[0].text).toContain("Wants a price list.");
  });

  it("marks results as cacheable only by the requesting client", async () => {
    const list = await rpc("resources/list");
    expect(list.result.cacheScope).toBe("private");
  });

  it("answers a missing or malformed note URI with -32602, not empty contents", async () => {
    for (const uri of [`note://${crypto.randomUUID()}`, "note://not-a-uuid"]) {
      const msg = await rpc("resources/read", { uri }, uri);
      expect(msg.result, uri).toBeUndefined();
      expect(msg.error.code, uri).toBe(-32602);
    }
  });
});
