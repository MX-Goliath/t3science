import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { replaceDescriptorCurrentValue } from "@t3tools/client-runtime/model-traits";
import { getProviderModelCapabilities } from "../../providerModels";
import { withImplicitFastModeDefault } from "./composerProviderState";
import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import type { ScienceModelPreset } from "@t3tools/contracts/settings";
import { ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ReasoningSettingsCard, type ModelResetAction } from "./ReasoningSettingsCard";
import { ModelName } from "./ModelName";
import {
  sciencePresetMatches,
  sciencePresetDisabledReason,
  scienceModelEffortLabel,
} from "./scienceModelPresets";
import type { ModelEsque } from "./providerIconUtils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import styles from "./ReasoningSettingsCard.module.css";
import { getReasoningAppearance } from "./reasoningAppearance";

export function ScienceModelPresetsCard(props: {
  presets: readonly ScienceModelPreset[];
  selection: ModelSelection;
  entries: readonly ProviderInstanceEntry[];
  models: ReadonlyMap<ProviderInstanceId, readonly ModelEsque[]>;
  modelLabel: string;
  disabled: boolean;
  disabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  onSelect: (selection: ModelSelection) => void;
  onModelOptionsChange: (options: readonly ProviderOptionSelection[] | undefined) => void;
  onOpenModelPicker: () => void;
  modelReset: ModelResetAction;
}) {
  const entry = props.entries.find((entry) => entry.instanceId === props.selection.instanceId);
  const caps = entry
    ? getProviderModelCapabilities(entry.models, props.selection.model, entry.driverKind, true)
    : {};
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: withImplicitFastModeDefault(caps, props.selection.options),
  });
  const speed =
    descriptors.find(
      (descriptor) => descriptor.type === "select" && descriptor.id === "serviceTier",
    ) ??
    descriptors.find(
      (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
    ) ??
    null;
  const selected = props.presets.findIndex((preset) =>
    sciencePresetMatches(preset.modelSelection, props.selection, props.entries),
  );
  const reasons = props.presets.map((preset) =>
    sciencePresetDisabledReason(
      preset.modelSelection,
      props.entries,
      props.models,
      props.disabledReason,
    ),
  );
  return (
    <ReasoningSettingsCard
      effort={{
        id: "sciencePreset",
        label: "Science preset",
        type: "select",
        options: props.presets.map((preset, index) => ({
          id: String(index),
          label: preset.modelSelection
            ? [
                props.entries
                  .find((entry) => entry.instanceId === preset.modelSelection!.instanceId)
                  ?.models.find((model) => model.slug === preset.modelSelection!.model)?.name ??
                  preset.modelSelection.model,
                scienceModelEffortLabel(preset.modelSelection, props.entries),
              ]
                .filter(Boolean)
                .join(" · ")
            : "Choose model",
        })),
      }}
      value={selected < 0 ? props.modelLabel : String(selected)}
      valueLabel={scienceModelEffortLabel(props.selection, props.entries) ?? ""}
      hasSelection={selected >= 0}
      ultra={getReasoningAppearance(descriptors).ultra}
      speed={speed}
      speedValue={getProviderOptionCurrentValue(speed)}
      modelLabel={props.modelLabel}
      effortDisabled={false}
      selectionDisabled={props.disabled || reasons.every(Boolean)}
      onEffortChange={(value) => {
        const index = Number(value);
        const selection = props.presets[index]?.modelSelection;
        if (selection && !reasons[index]) props.onSelect(selection);
      }}
      optionDisabledReasons={reasons}
      onSpeedChange={(value) => {
        if (speed && !props.disabled)
          props.onModelOptionsChange(
            buildProviderOptionSelectionsFromDescriptors(
              replaceDescriptorCurrentValue(descriptors, speed.id, value),
            ),
          );
      }}
      modelReset={props.modelReset}
      onReset={props.modelReset.onReset}
      onOpenModelPicker={props.onOpenModelPicker}
    />
  );
}

export function ScienceManualModelCard(props: {
  modelLabel: string;
  onOpenModelPicker: () => void;
  modelReset: ModelResetAction;
}) {
  return (
    <div className="flex w-70 max-w-full items-start justify-between gap-2 px-2 py-2">
      <button
        type="button"
        onClick={props.onOpenModelPicker}
        className="flex min-w-0 items-center text-sm"
        aria-label={`Change model: ${props.modelLabel}`}
      >
        <ModelName>{props.modelLabel}</ModelName>
        <ChevronRightIcon className="size-3 shrink-0" />
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={styles.icon}
              aria-label={props.modelReset.label}
              disabled={Boolean(props.modelReset.disabledReason)}
              onClick={props.modelReset.onReset}
            />
          }
        >
          <RotateCcwIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>{props.modelReset.disabledReason ?? props.modelReset.label}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
