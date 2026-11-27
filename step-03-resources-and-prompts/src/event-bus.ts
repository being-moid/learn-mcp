import { env, waitUntil } from "cloudflare:workers";
import type { ServerEvent, ServerEventBus } from "@modelcontextprotocol/server";

// The SDK's change-event seam, backed by the NotificationHub Durable Object
// (see notification-hub.ts for why). The handler calls:
//   - subscribe(listener) inside a subscriptions/listen request, and
//   - publish(event) inside whichever request changed something
//     (via handler.notify.resourcesChanged()).

// One hub for the whole server for now. In step 4 this becomes one hub per
// company, named from the verified orgId, never from tool input.
const HUB_NAME = "global";

function hub() {
  return env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(HUB_NAME));
}

function logError(where: string, err: unknown): void {
  console.warn(JSON.stringify({ eventBus: where, error: err instanceof Error ? err.message : String(err) }));
}

export class HubEventBus implements ServerEventBus {
  publish(event: ServerEvent): void {
    // publish() must return immediately, but the hub call is async. waitUntil
    // keeps the request alive until the hub has the event, even after the
    // tool's response has been sent.
    waitUntil(hub().publish(event).catch((err) => logError("publish", err)));
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    // Runs inside the listening request, so the stream it opens and reads
    // belongs to that request: no cross-request I/O.
    const abort = new AbortController();
    const read = async () => {
      const res = await hub().fetch("https://notification-hub/listen", { signal: abort.signal });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) listener(JSON.parse(line) as ServerEvent);
        }
      }
    };
    read().catch((err) => {
      if (!abort.signal.aborted) logError("subscribe", err);
    });
    // Unsubscribe: stop reading, which closes the stream; the hub then drops it.
    return () => abort.abort();
  }
}
