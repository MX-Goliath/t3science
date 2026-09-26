import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import messageModel from "./050_ProjectionThreadMessageModelSelection.ts";
import pullRequests from "./050_ProjectionThreadPullRequests.ts";
import messageContext from "./051_ProjectionThreadMessageContext.ts";
import filesViewed from "./053_PullRequestFilesViewed.ts";
import autoSettle from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";

// Fork releases used upstream migration IDs 48, 50 and 54 for different schema changes.
// Reconcile by schema presence so both fork and upstream databases retain their history.
export default Effect.gen(function* () {
  yield* messageModel;
  yield* pullRequests;
  yield* messageContext;
  yield* filesViewed;
  yield* autoSettle;
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  if (!columns.some((column) => column.name === "title_state_json")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN title_state_json TEXT`;
  }
});
