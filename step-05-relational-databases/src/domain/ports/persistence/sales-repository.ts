import type { Answer, BusinessQuestion, DesignComparison, DesignComparisonRows, QuestionParameters, SchemaTable } from "../../sales";

/**
 * Read access to the sales database for ONE company, fixed when the
 * repository is built (from the caller's verified membership). No method
 * takes a company, so a caller can only ever reach their own company's rows.
 */
export interface SalesRepository {
  /** The sales tables, their columns and their keys and constraints. */
  describeSchema(): Promise<SchemaTable[]>;
  /** Runs one of the named questions for this company. */
  answer(question: BusinessQuestion, parameters: QuestionParameters): Promise<Answer>;
  /** Runs one comparison against the flat spreadsheet and this company's normalized tables. */
  compare(comparison: DesignComparison): Promise<DesignComparisonRows>;
}
