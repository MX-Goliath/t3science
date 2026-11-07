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
import { searchableSetting } from "./settingsSearch";

export function ScienceSettingsPanel() {
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
      <SettingsSection title="Science" id="science">
        <SettingsRow
          {...searchableSetting("scienceComposer")}
          description="Enable all Science composer controls, queue, work panels, scheduled sends and pinned attachments on this client. Turning it off restores the standard interface and pauses scheduled messages."
          control={
            <Switch
              checked={settings.scienceComposer}
              onCheckedChange={(checked) => updateSettings({ scienceComposer: Boolean(checked) })}
              aria-label="Science"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("science-model-presets")}
          description="Use a six-position bar to choose a model and reasoning level together. Picking a model manually hides the presets in that chat until you press Reset in the model menu. Requires Science."
          control={
            <Switch
              checked={settings.scienceModelPresetsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ scienceModelPresetsEnabled: Boolean(checked) })
              }
              aria-label="Model presets"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Model presets" id="science-preset-slots">
        <p className="pb-3 text-sm text-muted-foreground">
          Arrange six presets from left to right. Each can use a different provider. Presets are
          saved on this client; models must be available in the chat’s environment. Reset restores
          the project’s default model and reasoning level.
        </p>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const preset = settings.scienceModelPresets[index]!;
          const selection = preset.modelSelection;
          const entry = entries.find((entry) => entry.instanceId === selection?.instanceId);
          return (
            <SettingsRow
              key={index}
              title={`Position ${index + 1}`}
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
                    {...(!selection ? { triggerLabel: "Choose model" } : {})}
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
                      planModeEnabled={settings.planModeEnabled}
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
