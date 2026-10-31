import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { makeThreadFixture } from "../../test-fixtures";
import { useComposerSelection } from "./useComposerSelection";
import { TraitsPicker } from "./TraitsPicker";

it.each([true, false])(
  "resets to the project model with its saved options (%s), replacing remembered options",
  async (hasOptions) => {
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      stickyModelSelectionByProvider: {},
      stickyOptionsByModelByProvider: {},
      stickyActiveProvider: null,
    });
    const instanceId = ProviderInstanceId.make("codex");
    const driver = ProviderDriverKind.make("codex");
    const activeThread = makeThreadFixture();
    const target = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const projectDefault: ModelSelection = {
      instanceId,
      model: "project-model",
      ...(hasOptions ? { options: [{ id: "reasoningEffort", value: "low" }] } : {}),
    };
    useComposerDraftStore.getState().setModelSelection(target, {
      ...projectDefault,
      model: hasOptions ? "provider-model" : "project-model",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    useComposerDraftStore.getState().setStickyModelSelection({
      ...projectDefault,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    const capabilities = {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning effort",
          type: "select" as const,
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
      ],
    };
    const provider: ServerProvider = {
      instanceId,
      driver,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        {
          slug: "provider-model",
          name: "Provider model",
          isCustom: false,
          isDefault: true,
          capabilities,
        },
        { slug: "project-model", name: "Project model", isCustom: false, capabilities },
      ],
      slashCommands: [],
      skills: [],
    };
    function Composer() {
      const selection = useComposerDraftStore(
        (state) =>
          state.draftsByThreadKey[scopedThreadKey(target)]!.modelSelectionByProvider[instanceId]!,
      );
      const { modelReset } = useComposerSelection({
        environmentId: activeThread.environmentId,
        composerDraftTarget: target,
        draftThread: null,
        activeThread,
        activeRuntime: null,
        activeProjectSettings: {
          settings: { newWorktreesStartFromOrigin: false, defaultModelSelection: projectDefault },
        },
        settings: {
          ...DEFAULT_UNIFIED_SETTINGS,
          defaultModelSelection: { instanceId, model: "provider-model" },
        },
        providerStatuses: [provider],
        lockedProvider: null,
        supportsProviderSwitchingViaHandoff: false,
        multipleModelSelections: null,
        runtimeMode: "full-access",
        interactionMode: "default",
        interactionModeEnabled: false,
        isLocalDraftThread: false,
        canOverrideServerThreadEnvMode: false,
        setPendingServerThreadEnvModeEntry: vi.fn(),
        setPendingServerThreadStartFromOriginByThreadId: vi.fn(),
        scheduleComposerFocus: vi.fn(),
      });
      return (
        <TraitsPicker
          isComposerOwned
          provider={driver}
          instanceId={instanceId}
          threadRef={target}
          model={selection.model}
          models={provider.models}
          modelOptions={selection.options}
          planModeEnabled
          modelReset={modelReset}
        />
      );
    }
    await using screen = await render(<Composer />);
    await screen.getByRole("button", { name: /^Effort:/ }).click();
    await page.getByRole("button", { name: "Reset to project default: Project model" }).click();
    await expect
      .element(page.getByRole("slider"))
      .toHaveAttribute("aria-valuetext", hasOptions ? "Low" : "Medium");
    const state = useComposerDraftStore.getState();
    const expectedSelection = {
      ...projectDefault,
      options: projectDefault.options ?? [{ id: "reasoningEffort", value: "medium" }],
    };
    expect(
      state.draftsByThreadKey[scopedThreadKey(target)]?.modelSelectionByProvider[instanceId],
    ).toEqual(expectedSelection);
    expect(state.stickyModelSelectionByProvider[instanceId]).toEqual(expectedSelection);
    expect(state.stickyOptionsByModelByProvider[instanceId]?.[projectDefault.model]).toEqual(
      expectedSelection.options,
    );
  },
);
