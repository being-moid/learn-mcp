import type { BusinessDatabaseStatus, BusinessDatabaseStatusReader } from "../../../domain/ports/persistence/business-database-status";

// Stands in for Neon in the Workers-runtime tests (vitest.config.ts sets
// DATABASE_FOR_TESTS=memory), which have no network access to a database.
// The Neon reader itself is exercised against a real branch by
// `npm run db:migrate` and the end-to-end tests.
export class FixedDatabaseStatusReader implements BusinessDatabaseStatusReader {
  async status(): Promise<BusinessDatabaseStatus> {
    return { migrations: [{ name: "0001_test.sql", appliedAt: "2026-11-28T00:00:00.000Z" }] };
  }
}
