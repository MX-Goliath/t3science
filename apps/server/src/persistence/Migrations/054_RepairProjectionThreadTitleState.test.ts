import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import repairTitleState from "./054_RepairProjectionThreadTitleState.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "054_RepairProjectionThreadTitleState",
  (it) => {
    it.effect("adds the missing column and is safe to rerun", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 51 });
        yield* runMigrations({ toMigrationInclusive: 54 });
        const columns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(projection_threads)`;
        assert.isTrue(columns.some((column) => column.name === "title_state_json"));
        yield* repairTitleState;
      }),
    );
  },
);
