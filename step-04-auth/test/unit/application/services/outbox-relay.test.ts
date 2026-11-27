import { beforeEach, describe, expect, it } from "vitest";
import { OutboxRelay } from "../../../../src/application/services/outbox-relay";
import type { OutboxConsumer } from "../../../../src/domain/ports/outbox/outbox-consumer";
import { InMemoryOutboxStore } from "../../../fakes/in-memory-outbox-store";

/** A consumer that records what it handled and can be told to fail. */
class TestConsumer implements OutboxConsumer {
  readonly handled: string[] = [];
  failing = false;
  constructor(
    readonly name: string,
    readonly startFrom: "beginning" | "now",
    private readonly types: string[],
  ) {}
  handles(eventType: string): boolean {
    return this.types.includes(eventType);
  }
  async handle(event: { id: string }): Promise<void> {
    if (this.failing) throw new Error("provider down");
    this.handled.push(event.id);
  }
}

describe("OutboxRelay", () => {
  let store: InMemoryOutboxStore;
  beforeEach(() => {
    store = new InMemoryOutboxStore();
  });

  it("delivers the events a consumer handles, in order, and skips the rest", async () => {
    store.append("user.created");
    store.append("invitation.created");
    store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    const [result] = await new OutboxRelay(store, [consumer]).runOnce();
    expect(result).toEqual({ consumer: "c", delivered: 2, skipped: 1, failed: false });
    expect(consumer.handled).toEqual(["evt-2", "evt-3"]);
    expect(store.consumers.get("c")?.lastSeq).toBe(3);
  });

  it("doesn't deliver an event twice across runs", async () => {
    store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    const relay = new OutboxRelay(store, [consumer]);
    await relay.runOnce();
    await relay.runOnce();
    store.append("invitation.created");
    await relay.runOnce();
    expect(consumer.handled).toEqual(["evt-1", "evt-2"]);
  });

  it("starts a new 'now' consumer at the end of the log, and a 'beginning' one at the start", async () => {
    store.append("invitation.created");
    const fresh = new TestConsumer("fresh", "now", ["invitation.created"]);
    const history = new TestConsumer("history", "beginning", ["invitation.created"]);
    await new OutboxRelay(store, [fresh, history]).runOnce();
    expect(fresh.handled).toEqual([]);
    expect(history.handled).toEqual(["evt-1"]);
  });

  it("stops a failing consumer at the failed event, keeps order, and retries it next run", async () => {
    store.append("invitation.created");
    store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    consumer.failing = true;
    const relay = new OutboxRelay(store, [consumer]);

    const [failed] = await relay.runOnce();
    expect(failed.failed).toBe(true);
    expect(store.consumers.get("c")).toMatchObject({ lastSeq: 0, attempts: 1, failedAt: null });
    expect(store.consumers.get("c")?.lastError).toContain("evt-1");

    consumer.failing = false;
    await relay.runOnce();
    expect(consumer.handled).toEqual(["evt-1", "evt-2"]);
    expect(store.consumers.get("c")).toMatchObject({ lastSeq: 2, attempts: 0, lastError: null });
  });

  it("stops a consumer for good after too many failures", async () => {
    store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    consumer.failing = true;
    const relay = new OutboxRelay(store, [consumer], { maxAttempts: 3, now: () => new Date("2026-11-27T12:00:00Z") });
    for (let i = 0; i < 3; i++) await relay.runOnce();
    expect(store.consumers.get("c")).toMatchObject({ attempts: 3, failedAt: "2026-11-27T12:00:00.000Z" });

    // Even once the cause is fixed, it waits for a person to reset it.
    consumer.failing = false;
    const [result] = await relay.runOnce();
    expect(result.failed).toBe(true);
    expect(consumer.handled).toEqual([]);
  });

  it("doesn't let one failing consumer hold up another", async () => {
    store.append("invitation.created");
    const broken = new TestConsumer("broken", "beginning", ["invitation.created"]);
    broken.failing = true;
    const healthy = new TestConsumer("healthy", "beginning", ["invitation.created"]);
    await new OutboxRelay(store, [broken, healthy]).runOnce();
    expect(healthy.handled).toEqual(["evt-1"]);
  });

  it("delivers at most batchSize events per run", async () => {
    for (let i = 0; i < 5; i++) store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    const relay = new OutboxRelay(store, [consumer], { batchSize: 2 });
    await relay.runOnce();
    expect(consumer.handled).toHaveLength(2);
    await relay.runOnce();
    await relay.runOnce();
    expect(consumer.handled).toHaveLength(5);
  });

  it("stops quietly when another run moved the consumer first", async () => {
    store.append("invitation.created");
    store.append("invitation.created");
    const consumer = new TestConsumer("c", "beginning", ["invitation.created"]);
    const relay = new OutboxRelay(store, [consumer]);
    await store.consumer("c", "beginning");
    // Simulate a concurrent run that advanced the cursor mid-way.
    const original = store.advance.bind(store);
    store.advance = async (name, from, to) => {
      store.consumers.set(name, { ...store.consumers.get(name)!, lastSeq: 2 });
      return original(name, from, to);
    };
    const [result] = await relay.runOnce();
    expect(result.delivered).toBe(1);
    expect(store.consumers.get("c")?.lastSeq).toBe(2);
  });
});
