// @effect-diagnostics nodeBuiltinImport:off - Persistence tests create isolated local userdata.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopPetsModule from "./DesktopPets.ts";
import {
  DesktopPetOperationError,
  DesktopPetProtectedError,
  DesktopPetUnknownIdError,
} from "./DesktopPets.ts";

const NodeFS = NodeFSP;

type DesktopPetsTestError =
  | DesktopPetOperationError
  | DesktopPetProtectedError
  | DesktopPetUnknownIdError;

describe("DesktopPets", () => {
  it.effect("installs defaults, persists mutations, and protects bundled pets", () =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        NodeFS.mkdtemp(NodePath.join(process.env.TEMP ?? process.cwd(), "t3-desktop-pets-")),
      ),
      (stateDir) =>
        Effect.gen(function* () {
          const first = yield* runPets(stateDir, (pets) =>
            Effect.gen(function* () {
              const initial = yield* pets.getState;
              assert.equal(initial.enabled, true);
              assert.deepEqual(initial.pets.map((pet) => pet.id).sort(), [
                "claude",
                "openai-codex",
              ]);
              assert.deepEqual(initial.assignments, [
                { providerInstanceId: "claudeAgent", petId: "claude" },
                { providerInstanceId: "codex", petId: "openai-codex" },
              ]);
              yield* pets.setEnabled(false);
              yield* pets.assign("codex", "claude");
              return yield* pets.assign("claudeAgent", null);
            }),
          );
          assert.equal(first.enabled, false);
          assert.deepEqual(first.assignments, [{ providerInstanceId: "codex", petId: "claude" }]);

          const persisted = yield* runPets(stateDir, (pets) => pets.getState);
          assert.equal(persisted.enabled, false);
          assert.deepEqual(persisted.assignments, [
            { providerInstanceId: "codex", petId: "claude" },
          ]);
          const unknownFailure = yield* runPets(stateDir, (pets) =>
            Effect.result(pets.assign("codex", "missing-pet")),
          );
          assert.isTrue(Result.isFailure(unknownFailure));
          if (Result.isFailure(unknownFailure)) {
            assert.instanceOf(unknownFailure.failure, DesktopPetUnknownIdError);
          }
          const protectedFailure = yield* runPets(stateDir, (pets) =>
            Effect.result(pets.remove("claude")),
          );
          assert.isTrue(Result.isFailure(protectedFailure));
          if (Result.isFailure(protectedFailure)) {
            assert.instanceOf(protectedFailure.failure, DesktopPetProtectedError);
          }
        }),
      (stateDir) => Effect.promise(() => NodeFS.rm(stateDir, { recursive: true, force: true })),
    ),
  );
});

function runPets<T>(
  stateDir: string,
  run: (pets: DesktopPetsModule.DesktopPets["Service"]) => Effect.Effect<T, DesktopPetsTestError>,
): Effect.Effect<T, DesktopPetsTestError> {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    stateDir,
    isDevelopment: false,
    resolveResourcePathCandidates: (fileName: string) => [
      NodePath.resolve("apps/desktop/resources", fileName),
    ],
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
  const layer = DesktopPetsModule.layer.pipe(
    Layer.provide(Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment)),
  );
  return Effect.gen(function* () {
    const pets = yield* DesktopPetsModule.DesktopPets;
    return yield* run(pets);
  }).pipe(Effect.provide(layer));
}
