import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { fromYaml } from "@t3tools/shared/schemaYaml";

import { serializeUpdateManifest } from "./lib/update-manifest.ts";

class ReleasePreparationError extends Schema.TaggedError<ReleasePreparationError>()(
  "ReleasePreparationError",
  { message: Schema.String },
) {}

const encodeMetadata = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const LinuxUpdateManifest = fromYaml(
  Schema.Struct({
    version: Schema.String,
    files: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        sha512: Schema.String,
        size: Schema.Number,
        blockMapSize: Schema.optional(Schema.Number),
      }),
    ),
    path: Schema.String,
    sha512: Schema.String,
    releaseDate: Schema.String,
  }),
);
const decodeLinuxManifest = Schema.decodeEffect(LinuxUpdateManifest);
const encodeLinuxManifest = Schema.encodeEffect(LinuxUpdateManifest);

function validateStableVersion(version: string): void {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Release version must be a stable version such as 2.2.1, without v.");
  }
}

export function validateScienceReleaseVersion(version: string, versionCode: string): number {
  validateStableVersion(version);
  const code = Number(versionCode);
  if (!/^[1-9]\d*$/.test(versionCode) || !Number.isSafeInteger(code) || code > 2100000000) {
    throw new Error("Android version code must be an integer from 1 to 2100000000.");
  }
  return code;
}

export const prepareLinuxRelease = Effect.fn("prepareLinuxRelease")(function* (
  directory: string,
  version: string,
) {
  validateStableVersion(version);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.stat(path.join(directory, `T3-Science-${version}-x86_64.AppImage`));
  const linuxManifestPath = path.join(directory, "latest-linux.yml");
  const linuxManifest = yield* decodeLinuxManifest(yield* fs.readFileString(linuxManifestPath));
  const appImage = linuxManifest.files.find(
    (file) => file.url === `T3-Science-${version}-x86_64.AppImage`,
  );
  if (linuxManifest.version !== version || !appImage)
    throw new Error("Linux update manifest does not match this release.");
  yield* fs.writeFileString(
    linuxManifestPath,
    yield* encodeLinuxManifest({
      ...linuxManifest,
      files: [appImage],
      path: appImage.url,
      sha512: appImage.sha512,
    }),
  );
});

export const prepareWindowsRelease = Effect.fn("prepareWindowsRelease")(function* (
  directory: string,
  version: string,
) {
  validateStableVersion(version);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const now = yield* DateTime.now;
  const portable = `T3-Science-${version}-x64-portable.exe`;
  yield* fs.stat(path.join(directory, `T3-Science-${version}-x64.exe`));
  yield* fs.stat(path.join(directory, "latest.yml"));
  const portableBytes = yield* fs.readFile(path.join(directory, portable));
  const sha512 = Buffer.from(yield* crypto.digest("SHA-512", portableBytes)).toString("base64");
  yield* fs.writeFileString(
    path.join(directory, "latest-portable.yml"),
    serializeUpdateManifest(
      {
        version,
        releaseDate: DateTime.formatIso(now),
        files: [{ url: portable, sha512, size: portableBytes.length }],
        extras: { path: portable, sha512 },
      },
      { platformLabel: "Windows portable" },
    ),
  );
});

export const prepareAndroidRelease = Effect.fn("prepareAndroidRelease")(function* (
  directory: string,
  version: string,
  versionCode: string,
) {
  const code = validateScienceReleaseVersion(version, versionCode);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const apk = `T3-Science-${version}-android.apk`;
  const apkBytes = yield* fs.readFile(path.join(directory, apk));
  const sha256 = Buffer.from(yield* crypto.digest("SHA-256", apkBytes)).toString("hex");
  const metadata = yield* encodeMetadata({
    versionName: version,
    versionCode: code,
    packageName: "com.t3tools.t3science",
    url: `https://github.com/MX-Goliath/t3science/releases/download/v${version}/${apk}`,
    sha256,
  });
  yield* fs.writeFileString(path.join(directory, "android-update.json"), `${metadata}\n`);
});

export const prepareScienceRelease = Effect.fn("prepareScienceRelease")(function* (
  directory: string,
  version: string,
  versionCode: string,
) {
  validateScienceReleaseVersion(version, versionCode);
  yield* prepareLinuxRelease(directory, version);
  yield* prepareWindowsRelease(directory, version);
  yield* prepareAndroidRelease(directory, version, versionCode);
});

if (import.meta.main) {
  Command.run(
    Command.make(
      "prepare-science-release",
      {
        directory: Argument.String("directory"),
        version: Argument.String("version"),
        versionCode: Argument.String("android-version-code").pipe(Argument.optional),
        platform: Flag.Literals("platform", ["all", "linux", "windows", "android"]).pipe(
          Flag.withDefault("all"),
        ),
      },
      Effect.fn("prepareScienceReleaseCommand")(function* ({
        directory,
        version,
        versionCode,
        platform,
      }) {
        if (platform === "linux") return yield* prepareLinuxRelease(directory, version);
        if (platform === "windows") return yield* prepareWindowsRelease(directory, version);
        if (Option.isNone(versionCode)) {
          return yield* new ReleasePreparationError({
            message: "Android version code is required for Android releases.",
          });
        }
        return yield* platform === "android"
          ? prepareAndroidRelease(directory, version, versionCode.value)
          : prepareScienceRelease(directory, version, versionCode.value);
      }),
    ),
    { version: "0.0.0" },
  ).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
