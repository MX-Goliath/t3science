import "~/index.css";
import { useState } from "react";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { readPromptUltrathink, TraitsPicker } from "./TraitsPicker";

function settings(input: {
  provider: string;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  options: ReadonlyArray<ProviderOptionSelection>;
  prompt?: string;
  descriptorIds?: ReadonlyArray<string>;
  reportedOptions?: ReadonlyArray<ProviderOptionSelection>;
}) {
  const save = vi.fn();
  const instanceId = ProviderInstanceId.make("test-provider");
  const model: ServerProviderModel = {
    slug: "test-model",
    name: "GPT-6.1 Sol",
    isCustom: false,
    capabilities: { optionDescriptors: input.descriptors },
  };
  function Settings() {
    const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection> | undefined>(
      input.options,
    );
    const [prompt, setPrompt] = useState(input.prompt ?? "");
    return (
      <>
        <output aria-label="Prompt">{prompt}</output>
        <TraitsPicker
          isComposerOwned
          provider={ProviderDriverKind.make(input.provider)}
          instanceId={instanceId}
          model={model.slug}
          models={[model]}
          modelOptions={options}
          promptUltrathink={readPromptUltrathink(prompt)}
          onPromptEdit={setPrompt}
          planModeEnabled
          {...(input.descriptorIds ? { descriptorIds: input.descriptorIds } : {})}
          {...(input.reportedOptions
            ? {
                reportedModelSelection: {
                  instanceId,
                  model: model.slug,
                  options: input.reportedOptions,
                },
              }
            : {})}
          onModelOptionsChange={(next) => {
            save(next);
            setOptions(next);
          }}
        />
      </>
    );
  }
  return { Settings, save };
}

const effort: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning effort",
  type: "select",
  currentValue: "medium",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ],
};
const context: ProviderOptionDescriptor = {
  id: "contextWindow",
  label: "Context window",
  type: "select",
  currentValue: "normal",
  options: [
    { id: "normal", label: "Normal", isDefault: true },
    { id: "long", label: "Long" },
  ],
};

it("changes effort by keyboard, cycles speed tiers and resets both without losing context", async () => {
  const { Settings, save } = settings({
    provider: "codex",
    descriptors: [
      effort,
      {
        id: "serviceTier",
        label: "Speed",
        type: "select",
        currentValue: "default",
        options: [
          { id: "default", label: "Normal", isDefault: true },
          { id: "priority", label: "Fast" },
          { id: "ultra", label: "Ultrafast" },
        ],
      },
      context,
    ],
    options: [
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "default" },
      { id: "contextWindow", value: "long" },
    ],
  });
  await using screen = await render(<Settings />);
  await screen.getByRole("button", { name: /^Effort:/ }).click();
  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await page.getByRole("button", { name: "Speed: Normal. Switch to Fast" }).click();
  await page.getByRole("button", { name: "Speed: Fast. Switch to Ultrafast" }).click();
  expect(save).toHaveBeenLastCalledWith([
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "ultra" },
    { id: "contextWindow", value: "long" },
  ]);
  await page.getByRole("button", { name: "Speed: Ultrafast. Switch to Normal" }).click();
  await page.getByRole("button", { name: "Speed: Normal. Switch to Fast" }).click();
  await page.getByRole("button", { name: "Reset effort and speed" }).click();
  expect(save).toHaveBeenLastCalledWith([
    { id: "reasoningEffort", value: "medium" },
    { id: "serviceTier", value: "default" },
    { id: "contextWindow", value: "long" },
  ]);
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium");
});

it("keeps prompt-injected effort in sync and explicitly resets boolean fast mode", async () => {
  const { Settings, save } = settings({
    provider: "claudeAgent",
    descriptors: [
      {
        ...effort,
        type: "select",
        promptInjectedValues: ["ultrathink"],
        options: [...effort.options, { id: "ultrathink", label: "Ultrathink" }],
      },
      { id: "fastMode", label: "Fast mode", type: "boolean" },
      context,
    ],
    prompt: "Ultrathink:\nKeep this message",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
      { id: "contextWindow", value: "long" },
    ],
  });
  await using screen = await render(<Settings />);
  await screen.getByRole("button", { name: /^Effort:/ }).click();
  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Ultrathink");
  await act(() => slider.element().focus());
  await userEvent.keyboard("{Home}");
  await expect.element(screen.getByLabelText("Prompt")).toHaveTextContent("Keep this message");
  expect(save).toHaveBeenLastCalledWith([
    { id: "reasoningEffort", value: "low" },
    { id: "fastMode", value: true },
    { id: "contextWindow", value: "long" },
  ]);
  await userEvent.keyboard("{End}");
  await expect
    .element(screen.getByLabelText("Prompt"))
    .toHaveTextContent("Ultrathink: Keep this message");
  await page.getByRole("button", { name: "Reset effort and speed" }).click();
  expect(save).toHaveBeenLastCalledWith([
    { id: "reasoningEffort", value: "medium" },
    { id: "fastMode", value: false },
    { id: "contextWindow", value: "long" },
  ]);
  await expect.element(screen.getByLabelText("Prompt")).toHaveTextContent("Keep this message");
});

it("uses reported OpenCode reasoning until a pick while preserving the separate agent", async () => {
  const { Settings, save } = settings({
    provider: "opencode",
    descriptors: [
      { ...effort, id: "variant" },
      {
        id: "agent",
        label: "Agent",
        type: "select",
        currentValue: "build",
        options: [{ id: "build", label: "Build", isDefault: true }],
      },
    ],
    descriptorIds: ["variant"],
    options: [{ id: "agent", value: "build" }],
    reportedOptions: [{ id: "variant", value: "low" }],
  });
  await using screen = await render(<Settings />);
  await screen.getByRole("button", { name: /^Effort:/ }).click();
  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  await expect.element(page.getByRole("button", { name: /^Speed:/ })).not.toBeInTheDocument();
  await act(() => slider.element().focus());
  await userEvent.keyboard("{End}");
  expect(save).toHaveBeenLastCalledWith([
    { id: "variant", value: "high" },
    { id: "agent", value: "build" },
  ]);
});
