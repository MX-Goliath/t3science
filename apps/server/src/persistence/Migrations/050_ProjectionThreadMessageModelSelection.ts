import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  // T3 Science previously shipped its message-model migration as 48. Upstream
  // later assigned 48 to this column, so existing fork databases skipped it.
  if (!threadColumns.some((column) => column.name === "branch_pull_request_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN branch_pull_request_json TEXT
    `;
  }

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (!messageColumns.some((column) => column.name === "model_selection_json")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN model_selection_json TEXT
    `;
  }
});
