import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE relay_activity_publications (
      relay_issuer TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (relay_issuer, thread_id)
    )
  `;
});
