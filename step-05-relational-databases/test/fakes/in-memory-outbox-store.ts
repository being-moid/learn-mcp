import type { OutboxEvent } from "../../src/domain/entities/outbox-event";
import type { ConsumerState, OutboxStore, StartFrom } from "../../src/domain/ports/outbox/outbox-store";

/** An in-memory OutboxStore for unit tests: `append` plays the part of the triggers. */
export class InMemoryOutboxStore implements OutboxStore {
  readonly events: OutboxEvent[] = [];
  readonly consumers = new Map<string, ConsumerState>();

  append(eventType: string, payload: Record<string, unknown> = {}): OutboxEvent {
    const seq = this.events.length + 1;
    const event = { seq, id: `evt-${seq}`, aggregateType: eventType.split(".")[0], aggregateId: `agg-${seq}`, eventType, payload, occurredAt: "2026-11-27T00:00:00.000Z" };
    this.events.push(event);
    return event;
  }

  async eventsAfter(seq: number, limit: number): Promise<OutboxEvent[]> {
    return this.events.filter((e) => e.seq > seq).slice(0, limit);
  }

  async consumer(name: string, startFrom: StartFrom): Promise<ConsumerState> {
    if (!this.consumers.has(name)) {
      const lastSeq = startFrom === "now" ? (this.events.at(-1)?.seq ?? 0) : 0;
      this.consumers.set(name, { name, lastSeq, attempts: 0, lastError: null, failedAt: null });
    }
    return { ...this.consumers.get(name)! };
  }

  async advance(name: string, fromSeq: number, toSeq: number): Promise<boolean> {
    const state = this.consumers.get(name);
    if (!state || state.lastSeq !== fromSeq) return false;
    this.consumers.set(name, { ...state, lastSeq: toSeq, attempts: 0, lastError: null });
    return true;
  }

  async recordFailure(name: string, attempts: number, error: string, failedAt: string | null): Promise<void> {
    const state = this.consumers.get(name)!;
    this.consumers.set(name, { ...state, attempts, lastError: error, failedAt });
  }
}
