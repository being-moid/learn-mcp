import type { QueryFn } from "./sql-sales-repository";
import { neonSql, type NeonBindings } from "./neon-connection";

/** A QueryFn over Neon's HTTP driver: each call is one HTTPS request, no connection kept. */
export function neonQuery(bindings: NeonBindings): QueryFn {
  return async (text, params) => {
    const sql = await neonSql(bindings);
    return (await sql.query(text, params)) as Array<Record<string, unknown>>;
  };
}
