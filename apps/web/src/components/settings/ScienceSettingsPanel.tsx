import { m as translateScienceCopy } from "~/i18n/messages";
import { T, msg } from "gt-react";
import type { ScienceModelPreset } from "@t3tools/contracts/settings";
import { ProviderInstanceId } from "@t3tools/contracts";
import { Switch } from "../ui/switch";
import { ProviderModelPicker } from "../chat/ScienceProviderModelPicker";
import { TraitsPicker } from "../chat/ScienceTraitsPicker";
import { useEnvironmentProviders } from "../../state/environments";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function ScienceSettingsPanel() {
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment ? providersByEnvironment.get(environment.environmentId) : undefined) ?? [];
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, providers);
  const updatePreset = (index: number, patch: Partial<ScienceModelPreset>) => {
    updateSettings({
      scienceModelPresets: settings.scienceModelPresets.map((preset, position) =>
        position === index ? { ...preset, ...patch } : preset,
      ),
    });
  };
  return (
    <SettingsPageContainer>
      <SettingsSection title={translateScienceCopy(msg("Science"))} id="science">
        <SettingsRow
          {...setting("scienceComposer")}
          description={translateScienceCopy(
            msg(
              "Enable all Science composer controls, queue, work panels, scheduled sends and pinned attachments on this client. Turning it off restores the standard interface and pauses scheduled messages.",
            ),
          )}
          control={
            <Switch
              checked={settings.scienceComposer}
              onCheckedChange={(checked) => updateSettings({ scienceComposer: Boolean(checked) })}
              aria-label={translateScienceCopy(msg("Science"))}
            />
          }
        />
        <SettingsRow
          {...setting("science-model-presets")}
          description={translateScienceCopy(
            msg(
              "Use a six-position bar to choose a model and reasoning level together. Picking a model manually hides the presets in that chat until you press Reset in the model menu. Requires Science.",
            ),
          )}
          control={
            <Switch
              checked={settings.scienceModelPresetsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ scienceModelPresetsEnabled: Boolean(checked) })
              }
              aria-label={translateScienceCopy(msg("Model presets"))}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title={translateScienceCopy(msg("Legacy"))} id="science-legacy">
        <SettingsRow
          {...setting("legacy-context-window-indicator")}
          description={translateScienceCopy(
            msg(
              "Show context usage and manual compaction beside the Science composer. The thread details card is configured separately in Appearance.",
            ),
          )}
          control={
            <Switch
              checked={settings.contextWindowMeterEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ contextWindowMeterEnabled: Boolean(checked) })
              }
              aria-label={translateScienceCopy(msg("Context window indicator (legacy)"))}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title={translateScienceCopy(msg("Model presets"))} id="science-preset-slots">
        <p className="pb-3 text-sm text-muted-foreground">
          <T>
            Arrange six presets from left to right. Each can use a different provider. Presets are
            saved on this client; models must be available in the chat’s environment. Reset restores
            the project’s default model and reasoning level.
          </T>
        </p>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const preset = settings.scienceModelPresets[index]!;
          const selection = preset.modelSelection;
          const entry = entries.find((entry) => entry.instanceId === selection?.instanceId);
          return (
            <SettingsRow
              key={index}
              title={translateScienceCopy(msg("Position {value1}", { value1: index + 1 }))}
              control={
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-96">
                  <ProviderModelPicker
                    environmentId={environment?.environmentId ?? null}
                    activeInstanceId={
                      selection?.instanceId ??
                      entries[0]?.instanceId ??
                      ProviderInstanceId.make("codex")
                    }
                    model={selection?.model ?? ""}
                    {...(!selection
                      ? { triggerLabel: translateScienceCopy(msg("Choose model")) }
                      : {})}
                    lockedProvider={null}
                    instanceEntries={entries}
                    modelOptionsByInstance={modelOptionsByInstance}
                    onInstanceModelChange={(instanceId, model) =>
                      updatePreset(index, { modelSelection: { instanceId, model } })
                    }
                  />
                  {selection && entry ? (
                    <TraitsPicker
                      provider={entry.driverKind}
                      models={entry.models}
                      model={selection.model}
                      modelOptions={selection.options}
                      allowPromptInjectedEffort={false}
                      onModelOptionsChange={(options) =>
                        updatePreset(index, {
                          modelSelection: {
                            instanceId: selection.instanceId,
                            model: selection.model,
                            ...(options ? { options } : {}),
                          },
                        })
                      }
                    />
                  ) : null}
                </div>
              }
            />
          );
        })}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
