import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("050_ProjectionThreadMessageModelSelection", (it) => {
  it.effect("keeps upstream thread metadata and adds message model metadata", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* runMigrations({ toMigrationInclusive: 50 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const messageColumns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      const modelSelection = messageColumns.find(
        (column) => column.name === "model_selection_json",
      );

      assert.isTrue(threadColumns.some((column) => column.name === "branch_pull_request_json"));
      assert.equal(modelSelection?.name, "model_selection_json");
      assert.equal(modelSelection?.notnull, 0);
    }),
  );
});
