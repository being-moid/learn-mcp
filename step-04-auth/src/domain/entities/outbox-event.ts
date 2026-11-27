/** One recorded change, as the outbox relay delivers it. */
export interface OutboxEvent {
  /** Position in the log; events are delivered in this order. */
  seq: number;
  /** Unique event ID: consumers use it to ignore a repeat delivery. */
  id: string;
  aggregateType: string;
  aggregateId: string;
  /** e.g. "user.created", "invitation.created", "member.role_changed". */
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}
