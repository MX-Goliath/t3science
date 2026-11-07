import "~/index.css";
import { useState } from "react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DraftId } from "../../composerDraftStore";
import { ComposerControlsBar } from "./ScienceComposerControlsBar";

function Controls({
  descriptors,
  hiddenBlockCount = 0,
}: {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  hiddenBlockCount?: number;
}) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const instanceId = ProviderInstanceId.make("codex");
  const model = {
    slug: "test-model",
    name: "Test model",
    isCustom: false,
    capabilities: { optionDescriptors: descriptors },
  };
  return (
    <div data-chat-composer-resting-controls>
      <ComposerControlsBar
        environmentId={EnvironmentId.make("test")}
        routeKind="draft"
        routeThreadRef={{
          environmentId: EnvironmentId.make("test"),
          threadId: ThreadId.make("test"),
        }}
        draftId={DraftId.make("test-draft")}
        selectedProvider={ProviderDriverKind.make("codex")}
        selectedInstanceId={instanceId}
        selectedModel={model.slug}
        modelReset={{ label: "Reset model", disabledReason: null, onReset: () => {} }}
        selectedProviderModels={[model]}
        composerModelOptions={null}
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
        selectedModelSelection={{ instanceId, model: model.slug, options: [] }}
        onProviderModelSelect={() => {}}
        activeThreadModelSelection={undefined}
        selectedModelForPickerWithCustomFallback={model.slug}
        lockedProvider={null}
        lockedContinuationGroupKey={null}
        providerInstanceEntries={[]}
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
