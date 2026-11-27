import type { TransactionFn } from "../../readmodel/neon-readmodel-consumer";
import { neonSql, type NeonBindings } from "./neon-connection";

/**
 * A TransactionFn over Neon's HTTP driver: all statements go in ONE request,
 * which Neon runs as one transaction (BEGIN ... COMMIT), so they all apply or none do.
 */
export function neonTransaction(bindings: NeonBindings): TransactionFn {
  return async (statements) => {
    const sql = await neonSql(bindings);
    await sql.transaction(statements.map((s) => sql.query(s.text, s.params)));
  };
}
