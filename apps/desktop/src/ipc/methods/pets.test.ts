import { DesktopPetsStateSchema, type DesktopPetsState } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopPets from "../../pets/DesktopPets.ts";
import {
  assignDesktopPet,
  getDesktopPetsState,
  importDesktopPetArchive,
  removeDesktopPet,
  setDesktopPetsEnabled,
} from "./pets.ts";

const baseState: DesktopPetsState = {
  supported: true,
  enabled: true,
  assignments: [{ providerInstanceId: "codex", petId: "openai-codex" }],
  pets: [],
  errors: [],
};

const decodeState = Schema.decodeUnknownEffect(DesktopPetsStateSchema);

function petsLayer(calls: string[]) {
  return Layer.succeed(
    DesktopPets.DesktopPets,
    DesktopPets.DesktopPets.of({
      initialize: Effect.void,
      getState: Effect.succeed(baseState),
      setEnabled: (enabled) =>
        Effect.sync(() => {
          calls.push(`enabled:${enabled}`);
          return { ...baseState, enabled };
        }),
      assign: (providerInstanceId, petId) =>
        Effect.sync(() => {
          calls.push(`assign:${providerInstanceId}:${petId ?? "none"}`);
          return {
            ...baseState,
            assignments: petId === null ? [] : [{ providerInstanceId, petId }],
          };
        }),
      importArchive: (archivePath) =>
        Effect.sync(() => {
          calls.push(`import:${archivePath}`);
          return baseState;
        }),
      remove: (petId) =>
        Effect.sync(() => {
          calls.push(`remove:${petId}`);
          return baseState;
        }),
      resolveSpritesheet: () => Effect.succeed(null),
    }),
  );
}

describe("desktop pets IPC", () => {
  it.effect("validates payloads and delegates state mutations", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      assert.deepEqual(
        yield* getDesktopPetsState.handler(undefined).pipe(Effect.flatMap(decodeState)),
        baseState,
      );
      assert.equal(
        (yield* setDesktopPetsEnabled.handler(false).pipe(Effect.flatMap(decodeState))).enabled,
        false,
      );
      assert.deepEqual(
        (yield* assignDesktopPet
          .handler({ providerInstanceId: "codex_personal", petId: "claude" })
          .pipe(Effect.flatMap(decodeState))).assignments,
        [{ providerInstanceId: "codex_personal", petId: "claude" }],
      );
      assert.deepEqual(
        (yield* assignDesktopPet
          .handler({ providerInstanceId: "codex", petId: null })
          .pipe(Effect.flatMap(decodeState))).assignments,
        [],
      );
      yield* removeDesktopPet.handler({ petId: "custom" });
      assert.deepEqual(calls, [
        "enabled:false",
        "assign:codex_personal:claude",
        "assign:codex:none",
        "remove:custom",
      ]);

      const invalid = yield* Effect.result(
        assignDesktopPet.handler({ providerInstanceId: 42, petId: "claude" }),
      );
      assert.isTrue(Result.isFailure(invalid));
    }).pipe(Effect.provide(petsLayer(calls)));
  });

  it.effect("returns cancelled without importing when the picker is dismissed", () => {
    const calls: string[] = [];
    const dialogLayer = Layer.succeed(
      ElectronDialog.ElectronDialog,
      ElectronDialog.ElectronDialog.of({
        pickFiles: () => Effect.succeed([]),
      } as unknown as ElectronDialog.ElectronDialog["Service"]),
    );
    const windowLayer = Layer.succeed(
      ElectronWindow.ElectronWindow,
      ElectronWindow.ElectronWindow.of({
        focusedMainOrFirst: Effect.succeed(Option.none()),
      } as unknown as ElectronWindow.ElectronWindow["Service"]),
    );

    return Effect.gen(function* () {
      assert.deepEqual(yield* importDesktopPetArchive.handler(undefined), { kind: "cancelled" });
      assert.deepEqual(calls, []);
    }).pipe(Effect.provide(Layer.mergeAll(petsLayer(calls), dialogLayer, windowLayer)));
  });
});
