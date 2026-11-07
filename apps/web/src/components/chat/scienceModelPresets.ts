import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ScienceModelPreset } from "@t3tools/contracts/settings";
import {
  getProviderOptionDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionCurrentLabel,
} from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";
import { getReasoningAppearance } from "./reasoningAppearance";
import { withImplicitFastModeDefault } from "./composerProviderState";

export function scienceModelEffortLabel(
  selection: ModelSelection,
  entries: readonly ProviderInstanceEntry[],
) {
  const entry = entries.find((entry) => entry.instanceId === selection.instanceId);
  if (!entry) return null;
  const caps = getProviderModelCapabilities(entry.models, selection.model, entry.driverKind, true);
  const descriptors = getProviderOptionDescriptors({ caps, selections: selection.options });
  const appearance = getReasoningAppearance(descriptors);
  if (appearance.label) return appearance.label;
  const descriptor = descriptors.find(
    (option) => option.type === "select" && isReasoningSelect(option),
  );
  return descriptor ? getProviderOptionCurrentLabel(descriptor) : null;
}

export function sciencePresetMatches(
  preset: ModelSelection | null,
  current: ModelSelection,
  entries: readonly ProviderInstanceEntry[],
) {
  if (!preset || preset.instanceId !== current.instanceId || preset.model !== current.model)
    return false;
  const entry = entries.find((entry) => entry.instanceId === current.instanceId);
  if (!entry) return false;
  const caps = getProviderModelCapabilities(entry.models, current.model, entry.driverKind, true);
  const expected = getProviderOptionDescriptors({
    caps,
    selections: withImplicitFastModeDefault(caps, preset.options),
  });
  const actual = getProviderOptionDescriptors({
    caps,
    selections: withImplicitFastModeDefault(caps, current.options),
  });
  return expected
    .filter((descriptor) => descriptor.id !== "serviceTier" && descriptor.id !== "fastMode")
    .every(
      (descriptor) =>
        getProviderOptionCurrentValue(descriptor) ===
        getProviderOptionCurrentValue(actual.find((option) => option.id === descriptor.id)),
    );
}

export function sciencePresetDisabledReason(
  selection: ModelSelection | null,
  entries: readonly ProviderInstanceEntry[],
  models: ReadonlyMap<ProviderInstanceId, readonly ModelEsque[]>,
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null,
) {
  if (!selection) return "Configure this preset in Settings → Science";
  const entry = entries.find((entry) => entry.instanceId === selection.instanceId);
  if (
    !entry?.enabled ||
    !entry.isAvailable ||
    !models
      .get(selection.instanceId)
      ?.some((model) => model.slug === selection.model && !model.isUnavailable)
  ) {
    return "This model is unavailable in this environment";
  }
  return getModelDisabledReason(selection.instanceId, selection.model);
}

export function stepScienceModelPreset(input: {
  presets: readonly ScienceModelPreset[];
  selection: ModelSelection;
  entries: readonly ProviderInstanceEntry[];
  models: ReadonlyMap<ProviderInstanceId, readonly ModelEsque[]>;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  direction: 1 | -1;
}) {
  const current = input.presets.findIndex((preset) =>
    sciencePresetMatches(preset.modelSelection, input.selection, input.entries),
  );
  const start = current < 0 ? (input.direction > 0 ? -1 : 0) : current;
  for (let offset = 1; offset <= input.presets.length; offset++) {
    const index = (start + input.direction * offset + input.presets.length) % input.presets.length;
    const selection = input.presets[index]?.modelSelection;
    if (
      selection &&
      !sciencePresetDisabledReason(
        selection,
        input.entries,
        input.models,
        input.getModelDisabledReason,
      )
    )
      return selection;
  }
  return null;
}
