import type { OutboxConsumer } from "../../domain/ports/outbox/outbox-consumer";
import type { OutboxStore } from "../../domain/ports/outbox/outbox-store";

// The outbox relay: the background worker that delivers recorded changes to
// their consumers. It runs on a schedule (every minute) and right after
// requests that changed something, never inside the change itself.
//
// For each consumer, in order of the log:
//   - events it doesn't care about are skipped (its position moves on);
//   - an event it handles moves its position on only after it succeeds;
//   - a failure stops that consumer at that event (keeping order) and is
//     retried on the next run; after MAX_ATTEMPTS it stops for a person to
//     look at, without holding up any other consumer.
// Delivery is at least once: a crash between handling and saving the new
// position repeats the event, so consumers are idempotent.

export interface RelayResult {
  consumer: string;
  delivered: number;
  skipped: number;
  failed: boolean;
}

export interface OutboxRelayOptions {
  batchSize?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export class OutboxRelay {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: OutboxStore,
    private readonly consumers: readonly OutboxConsumer[],
    options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.now = options.now ?? (() => new Date());
  }

  /** One pass: up to `batchSize` events for each consumer. */
  async runOnce(): Promise<RelayResult[]> {
    const results: RelayResult[] = [];
    for (const consumer of this.consumers) results.push(await this.runConsumer(consumer));
    return results;
  }

  private async runConsumer(consumer: OutboxConsumer): Promise<RelayResult> {
    const result: RelayResult = { consumer: consumer.name, delivered: 0, skipped: 0, failed: false };
    const state = await this.store.consumer(consumer.name, consumer.startFrom, this.now().toISOString());
    if (state.failedAt) return { ...result, failed: true }; // stopped: needs a person

    let position = state.lastSeq;
    for (const event of await this.store.eventsAfter(position, this.batchSize)) {
      if (consumer.handles(event.eventType)) {
        try {
          await consumer.handle(event);
        } catch (err) {
          const attempts = state.attempts + 1;
          const failedAt = attempts >= this.maxAttempts ? this.now().toISOString() : null;
          const message = err instanceof Error ? err.message : String(err);
          await this.store.recordFailure(consumer.name, attempts, `event ${event.id} (${event.eventType}): ${message}`, failedAt, this.now().toISOString());
          return { ...result, failed: true };
        }
        result.delivered++;
      } else {
        result.skipped++;
      }
      // Save progress after every event, so a crash repeats at most one.
      if (!(await this.store.advance(consumer.name, position, event.seq, this.now().toISOString()))) return result; // another run moved it
      position = event.seq;
      state.attempts = 0;
    }
    return result;
  }
}
