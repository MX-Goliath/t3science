import { expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_SCIENCE_MODEL_PRESETS } from "@t3tools/contracts/settings";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  sciencePresetMatches,
  stepScienceModelPreset,
  scienceModelEffortLabel,
} from "./scienceModelPresets";

it("cycles models and reasoning across providers, skipping unavailable and forbidden slots", () => {
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");
  const providers = [codex, claude].map((instanceId): ServerProvider => ({
    instanceId,
    driver: ProviderDriverKind.make(instanceId),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "test-model",
        name: "Test model",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            { id: "fastMode", label: "Fast", type: "boolean", currentValue: false },
            {
              id: "serviceTier",
              label: "Speed",
              type: "select",
              currentValue: "default",
              options: [
                { id: "default", label: "Normal" },
                { id: "fast", label: "Fast" },
              ],
            },
            {
              id: "effort",
              label: "Effort",
              type: "select",
              currentValue: "low",
              options: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      },
    ],
    slashCommands: [],
    skills: [],
  }));
  const entries = deriveProviderInstanceEntries(providers);
  const presets = DEFAULT_SCIENCE_MODEL_PRESETS.map((preset, index) => ({
    ...preset,
    modelSelection:
      index === 0 || index === 3
        ? {
            instanceId: index === 0 ? codex : claude,
            model: "test-model",
            options: [{ id: "effort", value: index === 0 ? "low" : "high" }],
          }
        : index === 1
          ? { instanceId: codex, model: "removed-model" }
          : null,
  }));
  const models = new Map(providers.map((provider) => [provider.instanceId, provider.models]));
  const selection = presets[0]!.modelSelection!;
  const input = {
    presets,
    selection,
    entries,
    models,
    getModelDisabledReason: () => null,
    direction: 1 as const,
  };
  expect(
    sciencePresetMatches(
      selection,
      { ...selection, options: [{ id: "effort", value: "high" }] },
      entries,
    ),
  ).toBe(false);
  expect(
    sciencePresetMatches(
      selection,
      {
        ...selection,
        options: [
          ...selection.options!,
          { id: "fastMode", value: true },
          { id: "serviceTier", value: "fast" },
        ],
      },
      entries,
    ),
  ).toBe(true);
  expect(scienceModelEffortLabel(selection, entries)).toBe("Low");
  expect(scienceModelEffortLabel(presets[3]!.modelSelection!, entries)).toBe("High");
  expect(
    scienceModelEffortLabel(
      selection,
      entries.map((entry) => ({
        ...entry,
        models: entry.models.map((model) => ({
          ...model,
          capabilities: { optionDescriptors: [] },
        })),
      })),
    ),
  ).toBeNull();
  expect(stepScienceModelPreset(input)).toEqual(presets[3]!.modelSelection);
  expect(
    stepScienceModelPreset({ ...input, selection: presets[3]!.modelSelection!, direction: -1 }),
  ).toEqual(selection);
  expect(
    stepScienceModelPreset({
      ...input,
      getModelDisabledReason: (instanceId) =>
        instanceId === claude ? "Cannot hand off this thread" : null,
    }),
  ).toEqual(selection);
  expect(stepScienceModelPreset({ ...input, models: new Map() })).toBeNull();
});
