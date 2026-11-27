import type { OutboxConsumer } from "../../domain/ports/outbox/outbox-consumer";
import { project, projects, type ProjectedEvent, type Statement } from "./auth-readmodel-projection";

// The outbox publisher to Neon: an outbox consumer that applies each D1 event
// to the Neon read models (see auth-readmodel-projection.ts for what each
// event does).
//
// It starts from the beginning of the log, so a new Neon database gets the
// whole history of users, companies, members, invitations and roles, and
// then keeps up as the relay runs (every minute and after each POST).
//
// Each event is one Neon transaction: its inbox row plus its change. The
// relay delivers at least once (a crash can repeat the last event); a repeat
// hits the inbox's primary key, the transaction is refused and nothing is
// applied twice, and that refusal counts as success so the relay moves on.
// Any other failure throws, and the relay retries the event, in order.

/** Runs statements in one transaction: all apply, or none. */
export type TransactionFn = (statements: Statement[]) => Promise<void>;

export const NEON_READMODEL_CONSUMER = "neon-readmodel";

export class NeonReadModelConsumer implements OutboxConsumer {
  readonly name = NEON_READMODEL_CONSUMER;
  readonly startFrom = "beginning" as const;

  constructor(private readonly transaction: TransactionFn) {}

  handles(eventType: string): boolean {
    return projects(eventType);
  }

  async handle(event: ProjectedEvent): Promise<void> {
    try {
      await this.transaction(project(event));
    } catch (err) {
      if (isAlreadyApplied(err)) return;
      throw err;
    }
  }
}

/** Postgres' unique-violation (23505) on the inbox's primary key: this event was applied before. */
function isAlreadyApplied(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string };
  return e?.code === "23505" && (e.constraint === "outbox_inbox_pkey" || String(e.message).includes("outbox_inbox_pkey"));
}
