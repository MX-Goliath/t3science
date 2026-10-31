import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import { Platform } from "react-native";

import type { AppUpdateClient } from "./app-updates";

interface AndroidAppUpdates {
  check: () => Promise<boolean>;
  download: () => Promise<boolean>;
  install: () => Promise<boolean>;
}

export function createAndroidAppUpdateClient(): AppUpdateClient | null {
  if (Platform?.OS !== "android" || (typeof __DEV__ !== "undefined" && __DEV__)) return null;
  if (Constants.expoConfig?.extra?.appVariant !== "production") return null;
  const native = requireOptionalNativeModule<AndroidAppUpdates>("T3AppUpdates");
  if (!native) return null;
  return {
    isEnabled: true,
    installOnNextLaunch: true,
    installPendingOnLaunch: async () => {
      await native.install();
    },
    checkForUpdateAsync: async () => ({
      isAvailable: await native.check(),
      isRollBackToEmbedded: false,
    }),
    fetchUpdateAsync: async () => ({
      isNew: await native.download(),
      isRollBackToEmbedded: false,
    }),
    reloadAsync: async () => {
      await native.install();
    },
  };
}
