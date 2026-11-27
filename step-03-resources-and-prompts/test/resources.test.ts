import { describe, expect, it } from "vitest";
import { openListenStream, waitForHubListeners } from "./listen";
import { callTool, rpc } from "./mcp";

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

describe("list-changed notification, across requests", () => {
  it("reaches a listening client when another request creates or deletes a note", async () => {
    const listener = await openListenStream({ resourcesListChanged: true });
    expect(listener.contentType).toContain("text/event-stream");
    expect(await listener.waitFor("notifications/subscriptions/acknowledged"), `saw: ${listener.seen}`).toBe(true);
    expect(await waitForHubListeners(1), "listener connected to the hub").toBe(true);

    // A separate request (the tool call) changes the notes...
    const created = await callTool("create_note", { title: "Triggers a notification", body: "x" });
    // ...and the listening request hears about it.
    expect(await listener.waitFor("notifications/resources/list_changed"), `saw: ${listener.seen}`).toBe(true);

    await callTool("delete_note", { id: created.structuredContent.id });
    expect(await listener.waitFor("notifications/resources/list_changed"), `saw: ${listener.seen}`).toBe(true);
    await listener.close();
  }, 15_000);

  it("doesn't send it to a client that didn't ask for resource changes", async () => {
    const listener = await openListenStream({ toolsListChanged: true });
    expect(await listener.waitFor("notifications/subscriptions/acknowledged")).toBe(true);
    expect(await waitForHubListeners(1)).toBe(true);
    await callTool("create_note", { title: "Not for this listener", body: "x" });
    expect(await listener.waitFor("notifications/resources/list_changed", 1_000)).toBe(false);
    await listener.close();
  }, 15_000);
});
