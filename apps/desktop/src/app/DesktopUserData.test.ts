import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["linux", "win32", "darwin"] as const)(
  "keeps saved browser state on %s",
  (platform) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "science-profile-" });
      const current = path.join(directory, "t3science");
      yield* fs.makeDirectory(current);
      yield* fs.writeFileString(path.join(current, "saved-draft"), "scheduled message");
      assert.equal(
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment: false, platform }),
        current,
      );
      const legacy = path.join(directory, "T3 Science (Alpha)");
      yield* fs.makeDirectory(legacy);
      assert.equal(
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment: false, platform }),
        legacy,
      );
      assert.equal(
        yield* fs.readFileString(path.join(current, "saved-draft")),
        "scheduled message",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("keeps development data separate", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "science-dev-profile-" });
    assert.equal(
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: true,
        platform: "linux",
      }),
      path.join(directory, "t3science-dev"),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
