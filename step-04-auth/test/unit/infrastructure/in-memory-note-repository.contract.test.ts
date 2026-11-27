import { noteRepositoryContract } from "../../contracts/note-repository.contract";
import { InMemoryNoteRepository } from "../../fakes/in-memory-note-repository";

// The fake must behave like the real thing, or unit tests that use it prove nothing.
noteRepositoryContract("in-memory fake", () => new InMemoryNoteRepository());
