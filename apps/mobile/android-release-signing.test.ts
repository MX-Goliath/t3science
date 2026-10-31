import * as NodeModule from "node:module";
import { expect, it } from "vite-plus/test";

const { configureReleaseSigning } = NodeModule.createRequire(import.meta.url)(
  "./plugins/withAndroidReleaseSigning.cjs",
) as {
  configureReleaseSigning: (contents: string) => string;
};

it("uses the persistent key for release builds and keeps development signing intact", () => {
  const source = `android {
    signingConfigs {
        debug { storeFile file('debug.keystore') }
    }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}`;
  const result = configureReleaseSigning(source);
  expect(result).toContain("debug { signingConfig signingConfigs.debug }");
  expect(result).toContain("release {\n            signingConfig signingConfigs.release");
  expect(result).toContain("storeFile file(System.getenv('T3SCIENCE_ANDROID_KEYSTORE'))");
  expect(() => configureReleaseSigning(source.replace("buildTypes", "buildTypesChanged"))).toThrow(
    "Could not configure Android release signing.",
  );
});
