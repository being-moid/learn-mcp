import { DurableObject } from "cloudflare:workers";
import type { ServerEvent } from "@modelcontextprotocol/server";

// Why this exists
// ---------------
// A client that wants change notifications keeps a subscriptions/listen
// request open. A note is created by a *different* request, often on a
// different copy of the Worker. The Workers runtime forbids one request from
// touching another request's stream ("Cannot perform I/O on behalf of a
// different request"), so the SDK's default in-memory event bus can't deliver
// across requests here.
//
// A Durable Object is one single instance that every request can reach. Each
// listening request opens a stream *from* this hub and reads it in its own
// context; a request that changes notes calls publish() on the hub, and the
// hub writes to the streams it owns. No request ever touches another
// request's I/O.
//
// From step 4, there will be one hub per company (org:<orgId>), so one
// company's changes never reach another company's listeners.

const encoder = new TextEncoder();

export class NotificationHub extends DurableObject {
  // Open listener streams. Kept in memory on purpose: a stream only exists
  // while its listening request is connected, so there is nothing to persist.
  private listeners = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  /** A listening request connects here and receives one JSON event per line. */
  async fetch(): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.listeners.add(writer);
    // When the listener goes away, its stream errors; forget it.
    writer.closed.catch(() => undefined).finally(() => this.listeners.delete(writer));
    return new Response(readable, { headers: { "content-type": "application/x-ndjson" } });
  }

  /** Sends one change event to every connected listener. */
  async publish(event: ServerEvent): Promise<void> {
    const line = encoder.encode(`${JSON.stringify(event)}\n`);
    await Promise.all(
      [...this.listeners].map((writer) =>
        writer.write(line).catch(() => {
          // A listener that can't be written to has disconnected.
          this.listeners.delete(writer);
        }),
      ),
    );
  }

  /** How many listeners are connected (used by tests). */
  async listenerCount(): Promise<number> {
    return this.listeners.size;
  }
}
