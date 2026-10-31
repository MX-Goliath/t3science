import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import { serializeUpdateManifest } from "./lib/update-manifest.ts";

const encodeMetadata = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export function validateScienceReleaseVersion(version: string, versionCode: string): number {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Release version must be a stable version such as 2.2.1, without v.");
  }
  const code = Number(versionCode);
  if (!/^[1-9]\d*$/.test(versionCode) || !Number.isSafeInteger(code) || code > 2100000000) {
    throw new Error("Android version code must be an integer from 1 to 2100000000.");
  }
  return code;
}

export const prepareScienceRelease = Effect.fn("prepareScienceRelease")(function* (
  directory: string,
  version: string,
  versionCode: string,
) {
  const code = validateScienceReleaseVersion(version, versionCode);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const now = yield* DateTime.now;
  const portable = `T3-Science-${version}-x64-portable.exe`;
  const apk = `T3-Science-${version}-android.apk`;
  for (const file of [
    `T3-Science-${version}-x64.exe`,
    `T3-Science-${version}-x86_64.AppImage`,
    "latest.yml",
    "latest-linux.yml",
  ]) {
    yield* fs.stat(path.join(directory, file));
  }
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

if (import.meta.main) {
  Command.run(
    Command.make(
      "prepare-science-release",
      {
        directory: Argument.String("directory"),
        version: Argument.String("version"),
        versionCode: Argument.String("android-version-code"),
      },
      ({ directory, version, versionCode }) =>
        prepareScienceRelease(directory, version, versionCode),
    ),
    { version: "0.0.0" },
  ).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
