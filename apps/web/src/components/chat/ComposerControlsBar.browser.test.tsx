import type { ChatComposerProps } from "./ChatComposer";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  DEFAULT_SCIENCE_MODEL_PRESETS,
  type ScienceModelPreset,
} from "@t3tools/contracts/settings";
import "~/index.css";
import { useState } from "react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DraftId, useComposerThreadDraft, useComposerDraftStore } from "../../composerDraftStore";
import { ComposerControlsBar } from "./ScienceComposerControlsBar";
import reasoningStyles from "./ReasoningSettingsCard.module.css";

function Controls({
  descriptors,
  driver = "codex",
  hiddenBlockCount = 0,
  presets,
  manual = false,
  onSelect = () => {},
  onReset = () => {},
}: {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  driver?: "codex" | "claudeAgent";
  hiddenBlockCount?: number;
  presets?: readonly ScienceModelPreset[];
  manual?: boolean;
  onSelect?: ChatComposerProps["onProviderModelSelect"];
  onReset?: () => void;
}) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const instanceId = ProviderInstanceId.make(driver);
  const draft = useComposerThreadDraft(DraftId.make("test-draft"));
  const options = draft.modelSelectionByProvider[instanceId]?.options ?? [];
  const model = {
    slug: "test-model",
    name: "Test model",
    isCustom: false,
    capabilities: { optionDescriptors: descriptors },
  };
  const provider: ServerProvider = {
    instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [model],
    slashCommands: [],
    skills: [],
  };
  return (
    <div data-chat-composer-resting-controls>
      <ComposerControlsBar
        {...(presets ? { scienceModelPresets: presets } : {})}
        sciencePresetsManual={manual}
        environmentId={EnvironmentId.make("test")}
        routeKind="draft"
        routeThreadRef={{
          environmentId: EnvironmentId.make("test"),
          threadId: ThreadId.make("test"),
        }}
        draftId={DraftId.make("test-draft")}
        selectedProvider={ProviderDriverKind.make(driver)}
        selectedInstanceId={instanceId}
        selectedModel={model.slug}
        modelReset={{ label: "Reset model", disabledReason: null, onReset }}
        selectedProviderModels={[model]}
        composerModelOptions={{ [instanceId]: options }}
        reportedModelSelection={undefined}
        promptUltrathink="none"
        onPromptEdit={() => {}}
        planModeEnabled
        planModeUiEnabled={false}
        effortDisplay="label"
        interactionMode="default"
        compatibleRuntimeMode="full-access"
        defaultRuntimeMode="full-access"
        compatibleRuntimeModeOptions={[]}
        toggleInteractionMode={() => {}}
        handleRuntimeModeChange={() => {}}
        composerControlsCollapsed={false}
        composerControlsHidden={false}
        restingHiddenBlockCount={hiddenBlockCount}
        iconOnlyBlockCount={0}
        showProviderUnavailable={false}
        providerSetupInstanceId={undefined}
        onOpenProviderSetup={() => {}}
        providerCatalogPending={false}
        isSendBusy={false}
        multipleModelsEnabled={false}
        multipleModelSelections={null}
        onMultipleModelSelectionsChange={() => {}}
        selectedModelSelection={{ instanceId, model: model.slug, options }}
        onProviderModelSelect={onSelect}
        activeThreadModelSelection={undefined}
        selectedModelForPickerWithCustomFallback={model.slug}
        lockedProvider={null}
        lockedContinuationGroupKey={null}
        providerInstanceEntries={deriveProviderInstanceEntries([provider])}
        keybindings={[]}
        modelOptionsByInstance={new Map([[instanceId, [model]]])}
        terminalOpen={false}
        modelPickerOpen={modelPickerOpen}
        onModelPickerOpenChange={setModelPickerOpen}
        modelPickerIconClassName={undefined}
        getModelDisabledReason={() => null}
      />
    </div>
  );
}

const levels = [
  { id: "low", label: "Low" },
  { id: "high", label: "High", isDefault: true },
];

it("opens reasoning from both composer controls and opens model selection from reasoning", async () => {
  await using screen = await render(
    <Controls
      descriptors={[
        { id: "reasoningEffort", label: "Reasoning effort", type: "select", options: levels },
      ]}
    />,
  );
  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  const search = page.getByPlaceholder("Search models...");
  for (const name of ["Test model", /^Effort:/]) {
    const trigger = screen.getByRole("button", { name, exact: typeof name === "string" });
    await trigger.click();
    await expect.element(slider).toBeVisible();
    await trigger.click();
    await expect.element(slider).not.toBeInTheDocument();
    await screen.getByRole("button", { name, exact: typeof name === "string" }).click();
    await expect.element(slider).toBeVisible();
    await expect.element(slider).toHaveFocus();
    await expect.element(search).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Change model: Test model" }).click();
    await expect.element(search).toBeVisible();
    await expect.element(slider).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(search).not.toBeInTheDocument();
  }
  await screen.rerender(
    <Controls
      hiddenBlockCount={1}
      descriptors={[
        { id: "reasoningEffort", label: "Reasoning effort", type: "select", options: levels },
      ]}
    />,
  );
  await screen.getByRole("button", { name: "Test model", exact: true }).click();
  await expect.element(slider).toBeVisible();
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(slider).not.toBeInTheDocument();
});

it("opens models directly unless the model offers multiple reasoning levels", async () => {
  await using screen = await render(<Controls descriptors={[]} />);
  for (const descriptors of [
    [],
    [{ id: "reasoningEffort", label: "Effort", type: "select" as const, options: [levels[0]!] }],
    [{ id: "contextWindow", label: "Context", type: "select" as const, options: levels }],
    [{ id: "thinking", label: "Thinking", type: "boolean" as const }],
  ]) {
    await screen.rerender(<Controls descriptors={descriptors} />);
    await screen.getByRole("button", { name: "Test model", exact: true }).click();
    const search = page.getByPlaceholder("Search models...");
    await expect.element(search).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(search).not.toBeInTheDocument();
  }
});

it.each([
  { id: "fastMode", label: "Fast", type: "boolean", currentValue: false },
  {
    id: "serviceTier",
    label: "Speed",
    type: "select",
    currentValue: "default",
    options: [
      { id: "default", label: "Normal" },
      { id: "fast", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
    ],
  },
] satisfies ProviderOptionDescriptor[])(
  "keeps speed ($id) and reset in the six-position model menu",
  async (speed) => {
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
    const instanceId = ProviderInstanceId.make("codex");
    const presets = DEFAULT_SCIENCE_MODEL_PRESETS.map((preset, index) => ({
      ...preset,
      modelSelection:
        index === 4
          ? null
          : {
              instanceId,
              model: "test-model",
              options: [
                {
                  id: "reasoningEffort",
                  value: index === 0 ? "low" : index === 5 ? "ultra" : "high",
                },
              ],
            },
    }));
    const onSelect = vi.fn();
    const onReset = vi.fn();
    await using screen = await render(
      <Controls
        descriptors={[
          {
            id: "reasoningEffort",
            label: "Reasoning effort",
            type: "select",
            options: [...levels, { id: "ultra", label: "Ultra" }],
          },
          speed,
        ]}
        presets={presets}
        onSelect={onSelect}
        onReset={onReset}
      />,
    );
    await screen.getByRole("button", { name: "Test model", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Science preset" });
    await expect.element(slider).toBeVisible();
    await expect.element(slider).toHaveAttribute("max", "5");
    await expect.element(slider).toHaveFocus();
    await page.getByRole("button", { name: "Speed: Normal. Switch to Fast", exact: true }).click();
    await expect
      .element(
        page.getByRole("button", {
          name: `Speed: Fast. Switch to ${speed.type === "boolean" ? "Normal" : "Ultrafast"}`,
          exact: true,
        }),
      )
      .toBeVisible();
    await expect.element(slider).toHaveValue("1");
    const effortTrigger = screen.getByRole("button", { name: /^Effort: High · Fast/ });
    await expect.element(effortTrigger).toBeVisible();
    expect(effortTrigger.element().querySelector("svg.lucide-zap")).not.toBeNull();
    const savedOptions = useComposerDraftStore
      .getState()
      .getComposerDraft(DraftId.make("test-draft"))?.modelSelectionByProvider[instanceId]?.options;
    expect(savedOptions).toContainEqual({
      id: speed.id,
      value: speed.type === "boolean" ? true : "fast",
    });
    expect(savedOptions).toContainEqual({ id: "reasoningEffort", value: "high" });
    if (speed.type === "select") {
      await page
        .getByRole("button", { name: "Speed: Fast. Switch to Ultrafast", exact: true })
        .click();
      const ultraTrigger = screen.getByRole("button", { name: /^Effort: High · Ultrafast/ });
      await expect.element(ultraTrigger).toBeVisible();
      expect(ultraTrigger.element().querySelectorAll("svg.lucide-zap")).toHaveLength(2);
    }
    await page
      .getByRole("button", {
        name: `Speed: ${speed.type === "boolean" ? "Fast" : "Ultrafast"}. Switch to Normal`,
        exact: true,
      })
      .click();
    const normalTrigger = screen.getByRole("button", { name: /^Effort: High/ });
    await expect.element(normalTrigger).not.toHaveAccessibleName(/Fast|Ultrafast/);
    expect(normalTrigger.element().querySelector("svg.lucide-zap")).toBeNull();

    await slider.click();
    await userEvent.keyboard("{End}");
    expect(onSelect).toHaveBeenLastCalledWith(instanceId, "test-model", {
      sciencePreset: presets[5]!.modelSelection,
      focusComposer: false,
    });
    useComposerDraftStore
      .getState()
      .setProviderModelOptions(
        DraftId.make("test-draft"),
        ProviderDriverKind.make("codex"),
        [{ id: "reasoningEffort", value: "ultra" }],
        { instanceId, model: "test-model" },
      );
    await expect.element(slider).toHaveValue("5");
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Test model · Ultra");
    const card = slider.element().closest("[data-effort-ultra]")!;
    expect(card.getAttribute("data-effort-ultra")).toBe("true");
    const sparkles = card.querySelector(`.${reasoningStyles.sparkles}`)!;
    expect(sparkles).not.toBeNull();
    expect(getComputedStyle(sparkles).animationName).toContain("reasoning-ultra-stars");
    await page.getByRole("button", { name: "Change model: Test model" }).click();
    await expect.element(page.getByPlaceholder("Search models...")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.rerender(<Controls descriptors={[]} presets={presets} manual onReset={onReset} />);
    await screen.getByRole("button", { name: "Test model", exact: true }).click();
    await expect.element(slider).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Reset model", exact: true }).click();
    expect(onReset).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  "gives Claude Ultracode the Ultra appearance (presets: %s)",
  async (presetsEnabled) => {
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
    const instanceId = ProviderInstanceId.make("claudeAgent");
    const presets = DEFAULT_SCIENCE_MODEL_PRESETS.map(() => ({
      modelSelection: {
        instanceId,
        model: "test-model",
        options: [{ id: "ultracode", value: true }],
      },
    }));
    const descriptors: ProviderOptionDescriptor[] = [
      { id: "effort", label: "Effort", type: "select", options: levels },
      { id: "ultracode", label: "Ultracode", type: "boolean", currentValue: false },
    ];
    useComposerDraftStore
      .getState()
      .setProviderModelOptions(
        DraftId.make("test-draft"),
        ProviderDriverKind.make("claudeAgent"),
        [{ id: "ultracode", value: true }],
        { instanceId, model: "test-model" },
      );
    await using screen = await render(
      <Controls
        driver="claudeAgent"
        descriptors={descriptors}
        {...(presetsEnabled ? { presets } : {})}
      />,
    );
    const trigger = screen.getByRole("button", { name: /^Effort:/ });
    expect(trigger.element().querySelector(`.${reasoningStyles.ultraLabel}`)).not.toBeNull();
    await screen.getByRole("button", { name: "Test model", exact: true }).click();
    const slider = page.getByRole("slider", { name: presetsEnabled ? "Science preset" : "Effort" });
    await expect.element(slider).toBeVisible();
    const card = slider.element().closest("[data-effort-ultra]")!;
    expect(card.getAttribute("data-effort-ultra")).toBe("true");
    const sparkles = card.querySelector(`.${reasoningStyles.sparkles}`)!;
    expect(sparkles).not.toBeNull();
    expect(getComputedStyle(sparkles).animationName).toContain("reasoning-ultra-stars");
    useComposerDraftStore
      .getState()
      .setProviderModelOptions(
        DraftId.make("test-draft"),
        ProviderDriverKind.make("claudeAgent"),
        [{ id: "ultracode", value: false }],
        { instanceId, model: "test-model" },
      );
    await expect.element(slider).toBeVisible();
    expect(trigger.element().querySelector(`.${reasoningStyles.ultraLabel}`)).toBeNull();
    expect(card.getAttribute("data-effort-ultra")).toBe("false");
    expect(card.querySelector(`.${reasoningStyles.sparkles}`)).toBeNull();
  },
);
