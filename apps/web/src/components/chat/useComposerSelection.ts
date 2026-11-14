import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { UnifiedSettings } from "@t3tools/contracts";
import type { Dispatch } from "react";
import type { ComposerThreadTarget, DraftSessionState } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useApplyThreadModelPick } from "./useApplyThreadModelPick";
import {
  type EnvironmentId,
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
  type ThreadId,
  RuntimeMode,
} from "@t3tools/contracts";
import type { deriveThreadStructureRuntime } from "@t3tools/client-runtime/state/thread-execution";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toastManager } from "../ui/toast";
import { resolveAppModelSelectionForInstance } from "../../modelSelection";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { withImplicitFastModeDefault } from "@t3tools/shared/model";
import type { ModelResetAction } from "./ReasoningSettingsCard";
import {
  draftModelSelectionApplies,
  resolveNewDraftStartFromOrigin,
  threadHasStarted,
} from "../../lib/chatThreadActions";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../../composerDraftStore";
import {
  getStartedThreadModelChangeBlockReason,
  deriveLockedProvider,
  makeModelDisabledReason,
} from "../ChatView.logic";
interface ComposerSelectionInput {
  readonly environmentId: EnvironmentId;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly draftThread: DraftSessionState | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeRuntime: ReturnType<typeof deriveThreadStructureRuntime>;
  readonly activeProjectSettings: {
    readonly settings: {
      readonly newWorktreesStartFromOrigin: boolean;
      readonly defaultModelSelection: ModelSelection | null;
    };
  };
  readonly settings: UnifiedSettings;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly lockedProvider: ReturnType<typeof deriveLockedProvider>;
  readonly supportsProviderSwitchingViaHandoff: boolean;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly runtimeMode: RuntimeMode;
  readonly isLocalDraftThread: boolean;
  readonly canOverrideServerThreadEnvMode: boolean;
  readonly setPendingServerThreadEnvModeEntry: Dispatch<
    SetStateAction<{ readonly threadId: ThreadId; readonly mode: DraftThreadEnvMode } | null>
  >;
  readonly setPendingServerThreadStartFromOriginByThreadId: Dispatch<
    SetStateAction<Record<string, boolean>>
  >;
  readonly scheduleComposerFocus: () => void;
}

/**
 * The composer's choices for the next turn: provider and model, runtime mode,
 * and where a new thread runs (local or a new worktree, from the remote's tip or not).
 */
export function useComposerSelection(input: ComposerSelectionInput) {
  const {
    environmentId,
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    activeProjectSettings,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    multipleModelSelections,
    runtimeMode,
    isLocalDraftThread,
    canOverrideServerThreadEnvMode,
    setPendingServerThreadEnvModeEntry,
    setPendingServerThreadStartFromOriginByThreadId,
    scheduleComposerFocus,
  } = input;
  const navigate = useNavigate();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const applyThreadModelPick = useApplyThreadModelPick();

  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    if (mode === runtimeMode) return;
    setComposerDraftRuntimeMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
    }
    scheduleComposerFocus();
  };
  const handleRuntimeModeChangeStable = useStableCallback(handleRuntimeModeChange);

  const openProviderSetup = (instanceId: ProviderInstanceId) => {
    void navigate({
      to: "/settings/providers",
      search: { environmentId, instanceId },
    });
  };
  const openProviderSetupStable = useStableCallback(openProviderSetup);

  // Keyed on the fields it reads: the thread and runtime objects change with
  // every streamed event, and a new function re-renders the whole model picker.
  const hasStartedSession = activeRuntime !== null;
  const runtimeProviderInstanceId = activeRuntime?.providerInstanceId ?? null;
  const currentModelSelection = activeThread?.modelSelection ?? null;
  const getModelDisabledReason = makeModelDisabledReason(
    currentModelSelection
      ? {
          hasStartedSession,
          supportsProviderSwitchingViaHandoff,
          currentModelSelection,
          currentProviderInstanceId: runtimeProviderInstanceId,
        }
      : null,
  );

  const onProviderModelSelect = (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean; sciencePreset?: ModelSelection; reset?: boolean },
  ) => {
    if (!activeThread) return;
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    const resolvedDriverKind = entry?.driver ?? null;
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      resolvedDriverKind !== null &&
      resolvedDriverKind !== lockedProvider
    ) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      activeRuntime?.providerInstanceId
    ) {
      const currentEntry = providerStatuses.find(
        (snapshot) => snapshot.instanceId === activeRuntime.providerInstanceId,
      );
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        if (options?.focusComposer !== false) scheduleComposerFocus();
        return;
      }
    }
    // The picker lists an unavailable model only as the active selection, so re-picking keeps it.
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providerStatuses,
      model,
      { preserveUnavailableSelection: true },
    );
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const storedDraft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    const draft = draftModelSelectionApplies(storedDraft, threadHasStarted(activeThread))
      ? storedDraft
      : null;
    const shownInstanceId =
      draft?.activeProvider ??
      activeRuntime?.providerInstanceId ??
      activeThread.modelSelection.instanceId;
    const shownSelection =
      draft?.modelSelectionByProvider[shownInstanceId] ?? activeThread.modelSelection;
    if (
      !resolvedModel ||
      (!options?.sciencePreset &&
        !options?.reset &&
        instanceId === shownInstanceId &&
        shownSelection.instanceId === instanceId &&
        shownSelection.model === resolvedModel)
    ) {
      if (resolvedModel && settings.scienceComposer && settings.scienceModelPresetsEnabled) {
        setComposerDraftModelSelection(threadRef, shownSelection, {
          explicit: true,
          sciencePreset: false,
        });
      }
      // Re-picking the shown model keeps its options and saves it again if that save failed.
      if (resolvedModel && !isLocalDraftThread) applyThreadModelPick(threadRef);
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const rememberedOptions =
      useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[resolvedModel];
    const nextModelSelection: ModelSelection =
      (options?.sciencePreset
        ? { ...options.sciencePreset, options: options.sciencePreset.options ?? [] }
        : undefined) ??
      (rememberedOptions !== undefined && rememberedOptions.length > 0
        ? { instanceId, model: resolvedModel, options: [...rememberedOptions] }
        : { instanceId, model: resolvedModel });
    const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
      hasStartedSession: activeRuntime !== null,
      supportsProviderSwitchingViaHandoff,
      currentModelSelection: activeThread.modelSelection,
      currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
      nextModelSelection,
    });
    if (modelChangeBlockReason) {
      toastManager.add({
        type: "warning",
        title: modelChangeBlockReason.title,
        description: modelChangeBlockReason.description,
      });
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    setComposerDraftModelSelection(threadRef, nextModelSelection, {
      explicit: true,
      replaceOptions: true,
      ...((settings.scienceComposer && settings.scienceModelPresetsEnabled) ||
      options?.sciencePreset
        ? { sciencePreset: Boolean(options?.sciencePreset) }
        : {}),
    });
    setStickyComposerModelSelection(nextModelSelection);
    if (!isLocalDraftThread) applyThreadModelPick(threadRef);
    if (options?.focusComposer !== false) scheduleComposerFocus();
    return true;
  };
  const onProviderModelSelectStable = useStableCallback(onProviderModelSelect);
  const presetsEnabled = settings.scienceComposer && settings.scienceModelPresetsEnabled;
  const defaultSelection =
    activeProjectSettings.settings.defaultModelSelection ??
    resolveProjectDefaultProviderModelSelection(
      providerStatuses,
      settings,
      activeThread?.projectId ?? null,
    );
  const defaultProvider = providerStatuses.find(
    (provider) => provider.instanceId === defaultSelection?.instanceId,
  );
  const defaultModel = defaultSelection
    ? resolveAppModelSelectionForInstance(
        defaultSelection.instanceId,
        settings,
        providerStatuses,
        defaultSelection.model,
      )
    : null;
  const resetDisabledReason =
    !defaultSelection || !defaultModel || !defaultProvider?.enabled
      ? "The project default model is unavailable"
      : getModelDisabledReason(defaultSelection.instanceId, defaultModel);
  const onResetModel = useStableCallback(() => {
    if (!defaultSelection || !defaultModel || resetDisabledReason) return;
    const applied = onProviderModelSelect(defaultSelection.instanceId, defaultModel, {
      focusComposer: false,
      reset: true,
      ...(presetsEnabled ? { sciencePreset: { ...defaultSelection, model: defaultModel } } : {}),
    });
    if (!applied || !defaultProvider) return;
    const caps = getProviderModelCapabilities(
      defaultProvider.models,
      defaultModel,
      defaultProvider.driver,
      false,
    );
    const defaultOptions = buildProviderOptionSelectionsFromDescriptors(
      getProviderOptionDescriptors({
        caps,
        selections: withImplicitFastModeDefault(caps, defaultSelection.options),
      }),
    );
    useComposerDraftStore
      .getState()
      .setProviderModelOptions(composerDraftTarget, defaultProvider.driver, defaultOptions, {
        instanceId: defaultSelection.instanceId,
        model: defaultModel,
        persistSticky: true,
      });
    if (!isLocalDraftThread) applyThreadModelPick(composerDraftTarget);
  });
  const defaultModelLabel =
    defaultProvider?.models.find((model) => model.slug === defaultModel)?.name ??
    defaultModel ??
    "Unavailable";
  const modelReset: ModelResetAction = {
    label: `Reset to project default: ${defaultModelLabel}`,
    disabledReason: resetDisabledReason,
    onReset: onResetModel,
  };
  const onEnvModeChange = (mode: DraftThreadEnvMode) => {
    if (multipleModelSelections !== null) return;
    if (canOverrideServerThreadEnvMode) {
      if (activeThread) setPendingServerThreadEnvModeEntry({ threadId: activeThread.id, mode });
      scheduleComposerFocus();
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        envMode: mode,
        startFromOrigin: resolveNewDraftStartFromOrigin({
          envMode: mode,
          newWorktreesStartFromOrigin: activeProjectSettings.settings.newWorktreesStartFromOrigin,
        }),
        ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
      });
    }
    scheduleComposerFocus();
  };
  const onEnvModeChangeStable = useStableCallback(onEnvModeChange);

  // Reads only the id: the shell changes on every streamed event, and a new handler
  // re-renders the branch toolbar and thread details panel with it.
  const activeThreadId = activeThread?.id;
  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    if (canOverrideServerThreadEnvMode && activeThreadId !== undefined) {
      setPendingServerThreadStartFromOriginByThreadId((current) =>
        current[activeThreadId] === nextStartFromOrigin
          ? current
          : { ...current, [activeThreadId]: nextStartFromOrigin },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };
  return {
    modelReset,
    getModelDisabledReason,
    handleRuntimeModeChangeStable,
    onEnvModeChangeStable,
    onProviderModelSelectStable,
    onStartFromOriginChange,
    openProviderSetupStable,
  };
}
