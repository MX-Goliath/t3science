#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { prebuildAndroid } from "./mobile-native-client.ts";

class MobileArtifactError extends Schema.TaggedError<MobileArtifactError>()("MobileArtifactError", {
  message: Schema.String,
}) {}

const main = Command.make(
  "build-mobile-artifact",
  {
    abi: Flag.Literals("abi", ["arm64-v8a", "x86_64", "all"]).pipe(Flag.withDefault("arm64-v8a")),
    output: Flag.String("output").pipe(Flag.withDefault("release/t3science-android.apk")),
  },
  Effect.fn("mobileArtifact.build")(function* ({ abi, output }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* HostProcess.Environment;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const repo = yield* path.fromFileUrl(new URL("../", import.meta.url));
    const mobile = path.join(repo, "apps/mobile");
    const android = path.join(mobile, "android");
    const tracked = yield* spawner.spawn(
      ChildProcess.make("git", ["ls-files", "--error-unmatch", "apps/mobile/android"], {
        cwd: repo,
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    if ((yield* tracked.exitCode) === 0)
      return yield* new MobileArtifactError({
        message: "Native directory contains tracked files; clean prebuild would overwrite them.",
      });

    const run = Effect.fn("mobileArtifact.command")(function* (
      program: string,
      args: string[],
      cwd: string,
    ) {
      const spawn = yield* resolveSpawnCommand(program, args);
      const child = yield* spawner.spawn(
        ChildProcess.make(spawn.command, spawn.args, {
          shell: spawn.shell,
          cwd,
          env: { ...environment, APP_VARIANT: "production", CI: "1", EXPO_NO_GIT_STATUS: "1" },
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        }),
      );
      const code = yield* child.exitCode;
      if (code !== 0)
        return yield* new MobileArtifactError({ message: `${program} failed (${code}).` });
    });
    yield* prebuildAndroid(
      mobile,
      run(
        "vp",
        ["exec", "expo", "prebuild", "--clean", "--platform", "android", "--no-install"],
        mobile,
      ),
    );
    yield* run(
      path.join(android, (yield* HostProcess.Platform) === "win32" ? "gradlew.bat" : "gradlew"),
      ["app:assembleRelease", ...(abi === "all" ? [] : [`-PreactNativeArchitectures=${abi}`])],
      android,
    );
    const target = path.resolve(repo, output);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.copyFile(path.join(android, "app/build/outputs/apk/release/app-release.apk"), target);
    yield* Console.log(`T3 Science Android APK: ${target}`);
  }),
);

if (import.meta.main) {
  Command.run(main, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
