import { beforeEach, describe, expect, it } from "vitest";
import { NotesService } from "../../../../src/application/services/notes-service";
import type { Principal } from "../../../../src/domain/entities/principal";
import { InMemoryNoteRepository } from "../../../fakes/in-memory-note-repository";
import { InMemoryRepositoryFactory } from "../../../fakes/in-memory-repository-factory";
import { RecordingChangeNotifier } from "../../../fakes/recording-change-notifier";

// NotesService on its own: no KV, no MCP, no Worker. The fakes stand in for
// the ports, which is what dependency inversion buys us.

describe("NotesService", () => {
  let repo: InMemoryNoteRepository;
  let changes: RecordingChangeNotifier;
  let service: NotesService;

  beforeEach(() => {
    repo = new InMemoryNoteRepository();
    changes = new RecordingChangeNotifier();
    let n = 0;
    service = new NotesService(repo, changes, {
      now: () => new Date("2026-11-27T10:00:00.000Z"),
      newId: () => `note-${++n}`,
    });
  });

  it("creates a note with a generated id and timestamp, and saves it", async () => {
    const note = await service.create({ title: "Call with Ali", body: "Price list by Friday", category: "call" });
    expect(note).toEqual({
      id: "note-1",
      createdAt: "2026-11-27T10:00:00.000Z",
      title: "Call with Ali",
      body: "Price list by Friday",
      category: "call",
    });
    expect(await repo.get("note-1")).toEqual(note);
  });

  it("announces a resource-list change when a note is created", async () => {
    await service.create({ title: "t", body: "b", category: "other" });
    expect(changes.resourcesChangedCount).toBe(1);
  });

  it("announces a change when a note is deleted, and reports success", async () => {
    const note = await service.create({ title: "t", body: "b", category: "other" });
    expect(await service.delete(note.id)).toBe(true);
    expect(changes.resourcesChangedCount).toBe(2);
    expect(await service.get(note.id)).toBeNull();
  });

  it("doesn't announce anything when deleting a note that doesn't exist", async () => {
    expect(await service.delete("missing")).toBe(false);
    expect(changes.resourcesChangedCount).toBe(0);
  });

  it("doesn't announce anything for reads", async () => {
    await service.list(10);
    await service.get("anything");
    expect(changes.resourcesChangedCount).toBe(0);
  });

  it("pages through notes with the repository's cursor", async () => {
    for (const title of ["a", "b", "c"]) await service.create({ title, body: "x", category: "other" });
    const first = await service.list(2);
    expect(first.notes.map((n) => n.title)).toEqual(["a", "b"]);
    expect(first.notes[0]).not.toHaveProperty("body");
    const second = await service.list(2, first.nextCursor!);
    expect(second.notes.map((n) => n.title)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("gives each caller only their own notes when built per principal", async () => {
    // How the composition root builds services: one repository per caller.
    const factory = new InMemoryRepositoryFactory();
    const alice: Principal = { kind: "user", userId: "alice", organizationId: "org-1" };
    const bob: Principal = { kind: "user", userId: "bob", organizationId: "org-1" };
    const forAlice = new NotesService(factory.notes(alice), changes);
    const forBob = new NotesService(factory.notes(bob), changes);

    const note = await forAlice.create({ title: "Alice's", body: "x", category: "other" });
    expect(await forAlice.get(note.id)).not.toBeNull();
    expect(await forBob.get(note.id)).toBeNull();
    expect((await forBob.list(10)).notes).toEqual([]);
  });
});
