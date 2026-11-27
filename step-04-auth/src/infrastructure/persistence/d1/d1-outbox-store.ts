import type { OutboxEvent } from "../../../domain/entities/outbox-event";
import type { ConsumerState, OutboxStore, StartFrom } from "../../../domain/ports/outbox/outbox-store";

// OutboxStore on D1: the "outbox" log (written only by the triggers in
// migrations/0004_outbox.sql) and "outbox_consumer" positions.
export class D1OutboxStore implements OutboxStore {
  constructor(private readonly db: D1Database) {}

  async eventsAfter(seq: number, limit: number): Promise<OutboxEvent[]> {
    const rows = await this.db
      .prepare(
        `SELECT "seq", "id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at"
           FROM "outbox" WHERE "seq" > ? ORDER BY "seq" LIMIT ?`,
      )
      .bind(seq, limit)
      .all<{ seq: number; id: string; aggregate_type: string; aggregate_id: string; event_type: string; payload: string; occurred_at: string }>();
    return rows.results.map((r) => ({
      seq: r.seq,
      id: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      occurredAt: r.occurred_at,
    }));
  }

  async consumer(name: string, startFrom: StartFrom, now: string): Promise<ConsumerState> {
    // Registers a new consumer at the start (0) or the current end of the log.
    // INSERT OR IGNORE keeps an existing consumer's position untouched.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO "outbox_consumer" ("name", "last_seq", "updated_at")
         VALUES (?, CASE WHEN ? = 'now' THEN (SELECT coalesce(max("seq"), 0) FROM "outbox") ELSE 0 END, ?)`,
      )
      .bind(name, startFrom, now)
      .run();
    const row = await this.db
      .prepare(`SELECT "name", "last_seq", "attempts", "last_error", "failed_at" FROM "outbox_consumer" WHERE "name" = ?`)
      .bind(name)
      .first<{ name: string; last_seq: number; attempts: number; last_error: string | null; failed_at: string | null }>();
    return { name: row!.name, lastSeq: row!.last_seq, attempts: row!.attempts, lastError: row!.last_error, failedAt: row!.failed_at };
  }

  async advance(name: string, fromSeq: number, toSeq: number, now: string): Promise<boolean> {
    // Only moves forward from where we read it, so two relay runs at once
    // can't move a consumer backwards or skip events.
    const result = await this.db
      .prepare(
        `UPDATE "outbox_consumer" SET "last_seq" = ?, "attempts" = 0, "last_error" = NULL, "updated_at" = ?
          WHERE "name" = ? AND "last_seq" = ?`,
      )
      .bind(toSeq, now, name, fromSeq)
      .run();
    return result.meta.changes === 1;
  }

  async recordFailure(name: string, attempts: number, error: string, failedAt: string | null, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE "outbox_consumer" SET "attempts" = ?, "last_error" = ?, "failed_at" = ?, "updated_at" = ? WHERE "name" = ?`)
      .bind(attempts, error.slice(0, 500), failedAt, now, name)
      .run();
  }
}
