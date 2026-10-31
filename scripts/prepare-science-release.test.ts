import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { parseUpdateManifest } from "./lib/update-manifest.ts";
import { prepareScienceRelease, validateScienceReleaseVersion } from "./prepare-science-release.ts";

const decodeMetadata = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      versionName: Schema.String,
      versionCode: Schema.Number,
      packageName: Schema.String,
      url: Schema.String,
      sha256: Schema.String,
    }),
  ),
);

it.effect("publishes portable and APK manifests for the exact release assets", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const directory = yield* fs.makeTempDirectoryScoped();
    const portable = "T3-Science-2.2.1-x64-portable.exe";
    const apk = "T3-Science-2.2.1-android.apk";
    for (const file of [
      portable,
      apk,
      "T3-Science-2.2.1-x64.exe",
      "T3-Science-2.2.1-x86_64.AppImage",
      "latest.yml",
      "latest-linux.yml",
    ]) {
      yield* fs.writeFileString(path.join(directory, file), file);
    }
    yield* prepareScienceRelease(directory, "2.2.1", "2002001");
    const manifest = parseUpdateManifest(
      yield* fs.readFileString(path.join(directory, "latest-portable.yml")),
      "latest-portable.yml",
      "Windows portable",
    );
    assert.equal(manifest.version, "2.2.1");
    assert.deepEqual(manifest.files, [
      {
        url: portable,
        size: portable.length,
        sha512: Buffer.from(
          yield* crypto.digest("SHA-512", new TextEncoder().encode(portable)),
        ).toString("base64"),
      },
    ]);
    const metadata = yield* decodeMetadata(
      yield* fs.readFileString(path.join(directory, "android-update.json")),
    );
    assert.deepEqual(metadata, {
      versionName: "2.2.1",
      versionCode: 2002001,
      packageName: "com.t3tools.t3science",
      url: `https://github.com/MX-Goliath/t3science/releases/download/v2.2.1/${apk}`,
      sha256: Buffer.from(yield* crypto.digest("SHA-256", new TextEncoder().encode(apk))).toString(
        "hex",
      ),
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("rejects prereleases, unsafe tags and invalid Android version codes", () => {
  for (const version of ["v2.2.1", "2.2.1-nightly.1", "2.2.1/../x", "02.2.1"]) {
    assert.throws(() => validateScienceReleaseVersion(version, "2"));
  }
  for (const code of ["0", "-1", "NaN", "1.5", "2100000001", "1e3"]) {
    assert.throws(() => validateScienceReleaseVersion("2.2.1", code));
  }
});
