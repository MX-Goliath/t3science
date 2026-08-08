import {
  type ModelCapabilities,
  type QwenCodeSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { createModelCapabilities } from "@t3tools/shared/model";
import { isCommandAvailable } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const QWEN_PRESENTATION = {
  displayName: "Qwen Code",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const QWEN_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "current",
    name: "Qwen configured model",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

function modelsFromSettings(settings: QwenCodeSettings): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    QWEN_BUILT_IN_MODELS,
    settings.customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

export function buildInitialQwenCodeProviderSnapshot(
  settings: QwenCodeSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    return buildServerProvider({
      presentation: QWEN_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Qwen Code CLI availability..."
          : "Qwen Code is disabled in T3 Code settings.",
      },
    });
  });
}

export const checkQwenCodeProviderStatus = Effect.fn("checkQwenCodeProviderStatus")(function* (
  settings: QwenCodeSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, FileSystem.FileSystem | Path.Path> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const available = settings.enabled
    ? yield* isCommandAvailable(settings.binaryPath || "qwen", { env: environment })
    : false;
  return buildServerProvider({
    presentation: QWEN_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: modelsFromSettings(settings),
    probe: {
      installed: available,
      version: null,
      status: available ? "ready" : "error",
      auth: { status: "unknown" },
      message: settings.enabled
        ? available
          ? "Qwen Code is available. Authentication is managed by the Qwen CLI."
          : `Qwen Code CLI '${settings.binaryPath || "qwen"}' was not found on PATH.`
        : "Qwen Code is disabled in T3 Code settings.",
    },
  });
});
