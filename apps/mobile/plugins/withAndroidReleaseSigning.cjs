const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withAndroidReleaseSigning(config) {
  if (!process.env.T3SCIENCE_ANDROID_KEYSTORE) return config;
  for (const name of [
    "T3SCIENCE_ANDROID_STORE_PASSWORD",
    "T3SCIENCE_ANDROID_KEY_ALIAS",
    "T3SCIENCE_ANDROID_KEY_PASSWORD",
  ]) {
    if (!process.env[name]) throw new Error(`Missing ${name} for Android release signing.`);
  }
  return withAppBuildGradle(config, (next) => {
    next.modResults.contents = configureReleaseSigning(next.modResults.contents);
    return next;
  });
};

function configureReleaseSigning(contents) {
  if (
    !contents.includes("signingConfigs {") ||
    !contents.includes("signingConfig signingConfigs.debug")
  ) {
    throw new Error(
      "Android Gradle signing template changed; refusing to ship a debug-signed release.",
    );
  }
  const signed = contents
    .replace(
      "signingConfigs {",
      `signingConfigs {
        release {
            storeFile file(System.getenv('T3SCIENCE_ANDROID_KEYSTORE'))
            storePassword System.getenv('T3SCIENCE_ANDROID_STORE_PASSWORD')
            keyAlias System.getenv('T3SCIENCE_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('T3SCIENCE_ANDROID_KEY_PASSWORD')
        }`,
    )
    .replace(
      /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig signingConfigs.release",
    );
  if (!signed.includes("signingConfig signingConfigs.release")) {
    throw new Error("Could not configure Android release signing.");
  }
  return signed;
}

module.exports.configureReleaseSigning = configureReleaseSigning;
