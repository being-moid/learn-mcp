/** One migration recorded as applied in the business database. */
export interface AppliedMigration {
  name: string;
  appliedAt: string;
}

/** What the business database (Neon) reports about itself. */
export interface BusinessDatabaseStatus {
  /** The migrations that have run, oldest first (empty before the first one). */
  migrations: AppliedMigration[];
}

/**
 * Reads the business database's status. Proves the Worker can reach Neon,
 * and shows which migrations have run there. Throws if the database can't be
 * reached (the tool kit turns that into a recoverable tool error).
 */
export interface BusinessDatabaseStatusReader {
  status(): Promise<BusinessDatabaseStatus>;
}
