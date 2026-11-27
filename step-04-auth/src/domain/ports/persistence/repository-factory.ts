import type { Principal } from "../../entities/principal";
import type { NoteRepository } from "./note-repository";

/**
 * The whole persistence layer behind one interface (an abstract factory).
 * Each storage backend (Workers KV today; D1 or Neon later; in-memory in unit
 * tests) is one class implementing this, and the composition root picks one.
 * Swapping databases means writing a new factory, not touching services or
 * tools.
 *
 * Every method takes the caller's Principal and returns repositories scoped
 * to it, so isolation is decided here, in one place per backend.
 */
export interface RepositoryFactory {
  notes(principal: Principal): NoteRepository;
}
