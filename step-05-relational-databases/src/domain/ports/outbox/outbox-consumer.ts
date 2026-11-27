import type { OutboxEvent } from "../../entities/outbox-event";

/**
 * Something that reacts to outbox events: sends an email, copies a change into
 * another database, … Delivery is at least once (a crash can repeat an event),
 * so a consumer must be idempotent, keyed by the event ID.
 */
export interface OutboxConsumer {
  /** Stable name; its position in the log is stored under it. */
  readonly name: string;
  /** Where it starts when first registered: "beginning" for full history, "now" for new events only. */
  readonly startFrom: "beginning" | "now";
  /** Whether it cares about this kind of event (others are skipped, in order). */
  handles(eventType: string): boolean;
  /** Handles one event; throws to have it retried later. */
  handle(event: { id: string; eventType: string; payload: Record<string, unknown>; occurredAt: string }): Promise<void>;
}
