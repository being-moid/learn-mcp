import type { BusinessDatabaseStatus, BusinessDatabaseStatusReader } from "../../../domain/ports/persistence/business-database-status";
import { neonSql, type NeonBindings } from "./neon-connection";

// Reads the status from Neon: one query proves the connection works, and the
// migration runner's own table (db/migrate.ts creates public.schema_migrations)
// says which migrations have run. Fixed SQL only; nothing from the model.
export class NeonDatabaseStatusReader implements BusinessDatabaseStatusReader {
  constructor(private readonly bindings: NeonBindings) {}

  async status(): Promise<BusinessDatabaseStatus> {
    const sql = await neonSql(this.bindings);
    // to_regclass is NULL until the runner has made the table (no migrations yet).
    const [{ ready }] = (await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ready`) as Array<{ ready: boolean }>;
    if (!ready) return { migrations: [] };
    const rows = (await sql`SELECT name, applied_at FROM public.schema_migrations ORDER BY name`) as Array<{ name: string; applied_at: string | Date }>;
    return { migrations: rows.map((r) => ({ name: r.name, appliedAt: new Date(r.applied_at).toISOString() })) };
  }
}
