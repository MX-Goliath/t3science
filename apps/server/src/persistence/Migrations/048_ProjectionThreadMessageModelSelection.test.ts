import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("048_ProjectionThreadMessageModelSelection", (it) => {
  it.effect("adds nullable model metadata to projected messages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* runMigrations({ toMigrationInclusive: 48 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      const modelSelection = columns.find((column) => column.name === "model_selection_json");

      assert.equal(modelSelection?.name, "model_selection_json");
      assert.equal(modelSelection?.notnull, 0);
    }),
  );
});
