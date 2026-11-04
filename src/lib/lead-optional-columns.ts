/**
 * Optional lead columns added by migrations that may not be applied yet.
 *
 * The lead list selects explicit columns, and PostgREST rejects a select that
 * names a column the database does not have (Postgres 42703). Asking for an
 * optional column through this helper keeps the list working before the
 * migration is applied: the first missing-column error drops it for the rest
 * of the session.
 */
export const LEAD_AI_TAG_COLUMN = "cs_tag_source";

type QueryError = { code?: string; message: string } | null;
type QueryResult<T> = { data: T | null; error: QueryError };

let aiTagColumnAvailable = true;

export function isMissingColumnError(error: QueryError, column: string): boolean {
  return Boolean(error && error.code === "42703" && error.message.includes(column));
}

export async function selectWithAiTagColumn<T>(
  baseColumns: string,
  run: (columns: string) => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  if (aiTagColumnAvailable) {
    const result = await run(`${baseColumns}, ${LEAD_AI_TAG_COLUMN}`);
    if (!isMissingColumnError(result.error, LEAD_AI_TAG_COLUMN)) return result;
    aiTagColumnAvailable = false;
  }
  return run(baseColumns);
}

/** Test hook: forget a previous missing-column result. */
export function resetOptionalLeadColumns() {
  aiTagColumnAvailable = true;
}
