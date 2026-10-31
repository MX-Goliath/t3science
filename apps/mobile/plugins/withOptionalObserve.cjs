const { withSettingsGradle, withPodfile } = require("expo/config-plugins");

module.exports = function withOptionalObserve(config, { enabled }) {
  if (enabled) return config;

  // Observe initializes before JS and requires an EAS project even when reporting is disabled.
  config = withSettingsGradle(config, (next) => {
    next.modResults.contents = next.modResults.contents.replace(
      "expoAutolinking.useExpoModules()",
      "expoAutolinking.exclude = ['expo-observe']\nexpoAutolinking.useExpoModules()",
    );
    return next;
  });
  return withPodfile(config, (next) => {
    next.modResults.contents = next.modResults.contents.replace(
      /use_expo_modules!\s*$/m,
      "use_expo_modules! :exclude => ['expo-observe']",
    );
    return next;
  });
};
