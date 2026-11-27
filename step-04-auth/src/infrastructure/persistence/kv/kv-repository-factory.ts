import type { Principal } from "../../../domain/entities/principal";
import type { NoteRepository } from "../../../domain/ports/persistence/note-repository";
import type { RepositoryFactory } from "../../../domain/ports/persistence/repository-factory";
import { KvNoteRepository } from "./kv-note-repository";

// The Workers KV backend. It is the one place that decides how a caller's
// data is separated in KV: by key prefix.
//
//   anonymous caller  -> note:<noteId>                          (today's server, no sign-in)
//   signed-in caller  -> org:<orgId>:user:<userId>:note:<noteId> (from stage 4)
//
// The IDs come from the Principal, which an AuthProvider built from verified
// credentials, never from tool input.
export class KvRepositoryFactory implements RepositoryFactory {
  constructor(private readonly notesNamespace: KVNamespace) {}

  notes(principal: Principal): NoteRepository {
    return new KvNoteRepository(this.notesNamespace, notePrefix(principal));
  }
}

export function notePrefix(principal: Principal): string {
  if (principal.kind === "anonymous") return "note:";
  return `org:${principal.organizationId}:user:${principal.userId}:note:`;
}
