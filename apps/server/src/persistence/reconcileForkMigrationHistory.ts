import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import reconcileSchema from "./Migrations/055_ReconcileForkSchema.ts";

/** Repair the fork's colliding V1 migration IDs before the V2 loader advances. */
export const reconcileForkMigrationHistory = Effect.fn("reconcileForkMigrationHistory")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql<{
      readonly name: string;
    }>`SELECT name FROM sqlite_master WHERE type = 'table'`;
    if (!tables.some((table) => table.name === "effect_sql_migrations")) return;
    const history = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations`;
    // The previous Science release used upstream's next migration id. Free it
    // before the loader advances, so scheduled-task webhooks are not skipped.
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 57 AND name = 'ScienceMessageModelSelection'`;
    const forkNames = new Set([
      "ProjectionThreadMessageModelSelection",
      "RepairProjectionThreadTitleState",
      "ReconcileForkSchema",
    ]);
    if (!history.some((row) => forkNames.has(row.name))) return;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`CREATE TABLE IF NOT EXISTS t3science_legacy_migration_history AS SELECT * FROM effect_sql_migrations`;
        yield* reconcileSchema;
        yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadBranchPullRequest' WHERE migration_id = 48 AND name = 'ProjectionThreadMessageModelSelection'`;
        yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadPullRequests' WHERE migration_id = 50 AND name = 'ProjectionThreadMessageModelSelection'`;
        yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadTitleState' WHERE migration_id = 52 AND name = 'ProjectionThreadPullRequests'`;
        yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadsAutoSettleDisabledAt' WHERE migration_id = 54 AND name = 'RepairProjectionThreadTitleState'`;
        yield* Effect.forEach(
          [
            [50, "ProjectionThreadPullRequests"],
            [51, "ProjectionThreadMessageContext"],
            [52, "ProjectionThreadTitleState"],
            [53, "PullRequestFilesViewed"],
            [54, "ProjectionThreadsAutoSettleDisabledAt"],
          ] as const,
          ([id, name]) => sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at)
      VALUES (${id}, ${name}, CURRENT_TIMESTAMP) ON CONFLICT (migration_id) DO NOTHING`,
          { discard: true },
        );
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 55 AND name = 'ReconcileForkSchema'`;
      }),
    );
  },
);
