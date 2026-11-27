import type { SalesRepository } from "../../../domain/ports/persistence/sales-repository";
import type { Answer, BusinessQuestion, DesignComparison, DesignComparisonRows, QuestionParameters, SchemaTable } from "../../../domain/sales";

// Stands in for Neon in the Workers-runtime tests (vitest.config.ts sets
// DATABASE_FOR_TESTS=memory), which can't reach a database. It returns small
// fixed answers so the tools' contracts can be tested; the real SQL is tested
// against a Neon branch by `npm run test:db` (test-db/).
export class FixedSalesRepository implements SalesRepository {
  constructor(private readonly organizationId: string) {}

  async describeSchema(): Promise<SchemaTable[]> {
    return [
      {
        name: "public.orders",
        description: "One row per order.",
        columns: [
          { name: "org_id", type: "text", nullable: false },
          { name: "order_id", type: "integer", nullable: false },
        ],
        constraints: [{ name: "orders_pkey", kind: "primary key", definition: "PRIMARY KEY (org_id, order_id)" }],
      },
    ];
  }

  async answer(question: BusinessQuestion, parameters: QuestionParameters): Promise<Answer> {
    // Echoes what it was asked, so a test can see the parameters arrive, and
    // the company it was built for, so a test can see it came from the token.
    return { question, rows: [{ organization: this.organizationId, limit: parameters.limit, customer: parameters.customer ?? null }] };
  }

  async compare(_comparison: DesignComparison): Promise<DesignComparisonRows> {
    return {
      flat: [{ key: "Corner Market", values: { cities: "Austin | Round Rock" } }],
      normalized: [{ key: "Corner Market", values: { cities: "Round Rock" } }],
      flatRowsSkipped: 0,
    };
  }
}
