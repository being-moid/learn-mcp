import { describe, expect, it } from "vitest";
import { openListenStream, waitForHubListeners } from "../helpers/listen";

// Step 05 has nothing that publishes a change (the notes are gone and the
// sales tools only read), so these tests only check that a client can still
// open a subscriptions/listen stream and that it reaches the caller's hub.
// The step 04 tests that a change reaches only its own caller come back with
// the first write tool (step 06).

describe("subscriptions/listen", () => {
  it("is acknowledged and connected to the caller's notification hub", async () => {
    const listener = await openListenStream({ toolsListChanged: true });
    expect(listener.contentType).toContain("text/event-stream");
    expect(await listener.waitFor("notifications/subscriptions/acknowledged"), `saw: ${listener.seen}`).toBe(true);
    expect(await waitForHubListeners(1), "listener connected to the hub").toBe(true);
    await listener.close();
  }, 15_000);
});
