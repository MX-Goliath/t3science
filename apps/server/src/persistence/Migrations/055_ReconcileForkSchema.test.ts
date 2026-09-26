import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
import forkMessageModel from "./050_ProjectionThreadMessageModelSelection.ts";
import reconcile from "./055_ReconcileForkSchema.ts";

for (const state of ["fresh", "fork-50", "failed-merge-54", "upstream-54"] as const) {
  it.effect(`reconciles ${state} without losing messages or their model metadata`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: state === "upstream-54" ? 54 : 49 });
      if (state === "fork-50" || state === "failed-merge-54") {
        yield* forkMessageModel;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (50, 'ProjectionThreadMessageModelSelection', CURRENT_TIMESTAMP)`;
      }
      if (state === "failed-merge-54") {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (54, 'RepairProjectionThreadTitleState', CURRENT_TIMESTAMP)`;
        yield* sql`ALTER TABLE projection_threads ADD COLUMN title_state_json TEXT`;
      }
      yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at) VALUES ('saved-message', 'saved-thread', 'assistant', 'Keep this conversation', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`;
      if (state === "fork-50" || state === "failed-merge-54") {
        yield* sql`UPDATE projection_thread_messages SET model_selection_json = '{"instanceId":"pi","model":"anthropic/claude"}' WHERE message_id = 'saved-message'`;
      }
      yield* runMigrations();
      yield* reconcile;
      const messages = yield* sql<{
        text: string;
        model: string | null;
        context: string | null;
      }>`SELECT text, model_selection_json AS model, context_json AS context FROM projection_thread_messages WHERE message_id = 'saved-message'`;
      assert.equal(messages[0]?.text, "Keep this conversation");
      if (state === "fork-50" || state === "failed-merge-54") {
        assert.equal(messages[0]?.model, '{"instanceId":"pi","model":"anthropic/claude"}');
      }
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_threads)`;
      for (const name of [
        "branch_pull_request_json",
        "title_state_json",
        "auto_settle_disabled_at",
      ]) {
        assert.isTrue(
          columns.some((column) => column.name === name),
          name,
        );
      }
      const tables = yield* sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type = 'table'`;
      for (const name of ["projection_thread_pull_requests", "pull_request_files_viewed"]) {
        assert.isTrue(
          tables.some((table) => table.name === name),
          name,
        );
      }
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
}
