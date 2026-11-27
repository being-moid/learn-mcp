import type { ServerNotifier } from "@modelcontextprotocol/server";
import type { ChangeNotifier } from "../../domain/ports/notifications/change-notifier";

// The ChangeNotifier port on top of the MCP handler's notify, which publishes
// through the NotificationHub (see event-bus.ts and hub.ts). A notification is
// only a "please re-list" hint, so failing to deliver one is logged, never
// thrown: it must not fail the tool that changed the notes.
export class McpChangeNotifier implements ChangeNotifier {
  constructor(private readonly notify: ServerNotifier) {}

  resourcesChanged(): void {
    try {
      this.notify.resourcesChanged();
    } catch (err) {
      console.warn(JSON.stringify({ notify: "resourcesChanged", error: err instanceof Error ? err.message : String(err) }));
    }
  }
}
