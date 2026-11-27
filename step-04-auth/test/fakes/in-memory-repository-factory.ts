import type { Principal } from "../../src/domain/entities/principal";
import type { NoteRepository } from "../../src/domain/ports/persistence/note-repository";
import type { RepositoryFactory } from "../../src/domain/ports/persistence/repository-factory";
import { InMemoryNoteRepository } from "./in-memory-note-repository";

/**
 * An in-memory RepositoryFactory: one store per principal, so unit tests can
 * check that callers are kept apart without KV.
 */
export class InMemoryRepositoryFactory implements RepositoryFactory {
  private readonly stores = new Map<string, InMemoryNoteRepository>();

  notes(principal: Principal): NoteRepository {
    const key = principal.kind === "anonymous" ? "anonymous" : `${principal.organizationId}/${principal.userId}`;
    let store = this.stores.get(key);
    if (!store) this.stores.set(key, (store = new InMemoryNoteRepository()));
    return store;
  }
}
