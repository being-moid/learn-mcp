import type { OutboxEvent } from "../../entities/outbox-event";

/** How far one consumer has got through the outbox, and whether it is stuck. */
export interface ConsumerState {
  name: string;
  lastSeq: number;
  attempts: number;
  lastError: string | null;
  /** Set after too many failures: the consumer stops until a person resets it. */
  failedAt: string | null;
}

/** Where a newly registered consumer starts reading. */
export type StartFrom = "beginning" | "now";

/** The outbox log and each consumer's position in it. */
export interface OutboxStore {
  /** Up to `limit` events after `seq`, oldest first. */
  eventsAfter(seq: number, limit: number): Promise<OutboxEvent[]>;

  /** The consumer's state, registering it (at the start or the end of the log) if it's new. */
  consumer(name: string, startFrom: StartFrom, now: string): Promise<ConsumerState>;

  /**
   * Moves the consumer from `fromSeq` to `toSeq` and clears its failures.
   * Returns false if it wasn't at `fromSeq` (another relay run moved it first).
   */
  advance(name: string, fromSeq: number, toSeq: number, now: string): Promise<boolean>;

  /** Records a failed try at the consumer's next event; `failedAt` stops it. */
  recordFailure(name: string, attempts: number, error: string, failedAt: string | null, now: string): Promise<void>;
}
