import { describe, expect, it } from "vitest";
import { openListenStream, waitForHubListeners } from "../helpers/listen";
import { callTool } from "../helpers/mcp";

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

describe("notifications reach only the caller who made the change", () => {
  it("doesn't ping a colleague in the same organization, or anyone in another", async () => {
    const { addMember, createAccount, issueAccessToken, registerClient } = await import("../helpers/oauth");
    const client = await registerClient();
    const alice = await createAccount("Alice");
    const aliceToken = await issueAccessToken(alice, client);
    const colleague = await addMember(alice, "Colleague");
    const colleagueToken = await issueAccessToken(colleague, client, colleague.organizationId);
    const stranger = await createAccount("Stranger");
    const strangerToken = await issueAccessToken(stranger, client);

    const listeners = {
      alice: await openListenStream({ resourcesListChanged: true }, aliceToken),
      colleague: await openListenStream({ resourcesListChanged: true }, colleagueToken),
      stranger: await openListenStream({ resourcesListChanged: true }, strangerToken),
    };
    for (const l of Object.values(listeners)) expect(await l.waitFor("notifications/subscriptions/acknowledged")).toBe(true);
    expect(await waitForHubListeners(1, alice)).toBe(true);
    expect(await waitForHubListeners(1, colleague)).toBe(true);
    expect(await waitForHubListeners(1, stranger)).toBe(true);

    await callTool("create_note", { title: "Alice's note", body: "x" }, aliceToken);

    expect(await listeners.alice.waitFor("notifications/resources/list_changed")).toBe(true);
    expect(await listeners.colleague.waitFor("notifications/resources/list_changed", 1_000)).toBe(false);
    expect(await listeners.stranger.waitFor("notifications/resources/list_changed", 1_000)).toBe(false);
    for (const l of Object.values(listeners)) await l.close();
  }, 20_000);
});
