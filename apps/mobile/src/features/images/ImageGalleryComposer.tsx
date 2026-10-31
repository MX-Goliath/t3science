import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@t3tools/client-runtime/model-traits";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CommandId,
  MessageId,
  ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  AuthOrchestrationOperateScope,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ImageLibraryEntry,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import {
  createNewTaskDraft,
  useComposerDraft,
  setComposerDraftText,
  removeComposerDraftAttachment,
  updateComposerDraftSettings,
  clearComposerDraftContent,
  clearComposerDraft,
  getComposerDraftSnapshot,
} from "../../state/use-composer-drafts";
import { useComposerAttachmentActions } from "../../state/use-composer-attachment-actions";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import { applyProviderOptionSelection } from "../../lib/providerOptions";
import {
  runtimeModeChoicesForSupportedModes,
  compatibleRuntimeModeForChoices,
} from "../threads/thread-settings-options";
import { buildModelOptions } from "../../lib/modelOptions";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { draftThreadShell } from "../threads/draft-thread-shell";
import { ThreadComposer } from "../threads/ThreadComposer";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { imageLibraryCopy } from "./imageLibraryCopy";
import { prepareImageGalleryMessage } from "./imageGallerySend";
import { prepareGalleryImage } from "./imageGalleryFiles";

type Props = {
  environmentId: EnvironmentId;
  image: ImageLibraryEntry | null;
  onHeightChange: (height: number) => void;
  bottomInset: number;
  onSent: () => void;
};

export function ImageGalleryComposer(props: Props) {
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const [session, setSession] = useState<{ project: EnvironmentProject; draftKey: string } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const copy = imageLibraryCopy();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- acquires a server scratch workspace and an isolated local draft for this gallery view
  useEffect(() => {
    if (session && getComposerDraftSnapshot(session.draftKey).project) return;
    const controller = new AbortController();
    void openScratch({ environmentId: props.environmentId, input: {} }).then((result) => {
      if (controller.signal.aborted) return;
      if (result._tag !== "Success") {
        setError(true);
        return;
      }
      setSession({
        project: result.value,
        draftKey: createNewTaskDraft({
          environmentId: props.environmentId,
          projectId: result.value.id,
        }),
      });
    });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- retry intentionally reacquires the scratch workspace
  }, [props.environmentId, openScratch, attempt, session]);
  if (!session)
    return (
      <View className="gap-2 p-4">
        <Text className="text-center text-foreground-muted">
          {error ? copy.failed : copy.preparing}
        </Text>
        {error ? (
          <Button
            label={copy.retry}
            onPress={() => {
              setError(false);
              setAttempt(attempt + 1);
            }}
          />
        ) : null}
      </View>
    );
  return <ReadyImageComposer {...props} {...session} />;
}

function ReadyImageComposer(props: Props & { project: EnvironmentProject; draftKey: string }) {
  const copy = imageLibraryCopy();
  const config = useEnvironmentServerConfig(props.environmentId);
  const draft = useComposerDraft(props.draftKey);
  const models = buildModelOptions(config, null, undefined, props.project.id).filter(
    (option) => !option.isUnavailable,
  );
  const selected =
    models.find(
      (option) =>
        option.selection.instanceId === draft.modelSelection?.instanceId &&
        option.selection.model === draft.modelSelection.model,
    ) ??
    models.find((option) => option.selection.instanceId === props.image?.providerInstanceId) ??
    models.find(
      (option) =>
        config?.providers.find((provider) => provider.instanceId === option.selection.instanceId)
          ?.driver === "codex",
    ) ??
    models[0];
  const selection = selected
    ? {
        ...selected.selection,
        ...(draft.modelSelection?.instanceId === selected.selection.instanceId &&
        draft.modelSelection.model === selected.selection.model
          ? { options: draft.modelSelection.options }
          : {}),
      }
    : null;
  const runtimeChoices = runtimeModeChoicesForSupportedModes(selected?.supportedRuntimeModes);
  const runtimeMode = compatibleRuntimeModeForChoices(
    draft.runtimeMode ?? config?.settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
    runtimeChoices,
  );
  const descriptors = selected?.capabilities
    ? getProviderOptionDescriptors({ caps: selected.capabilities, selections: selection?.options })
    : [];
  const optionChoices = descriptors.flatMap((descriptor) =>
    (descriptor.type === "select"
      ? descriptor.options.map((choice) => ({
          id: descriptor.id,
          value: choice.id,
          title: choice.label,
        }))
      : [
          { id: descriptor.id, value: true, title: copy.on },
          { id: descriptor.id, value: false, title: copy.off },
        ]
    ).map((choice) => ({ ...choice, key: `option:${descriptor.id}:${choice.value}` })),
  );
  const promptTraits = getPromptControlledTraits(descriptors, draft.text);
  const interactionMode = draft.interactionMode ?? "default";
  const isFocused = useIsFocused();
  const [metadata] = useState(makeTurnCommandMetadata);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const selectDetail = useSelectWorkspaceDetail();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const actions = useComposerAttachmentActions({
    draftKey: props.draftKey,
    serverConfig: config,
    locked: busy,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels source-image preparation when its gallery composer unmounts
  useEffect(
    () => () => {
      controller.current?.abort();
      const current = getComposerDraftSnapshot(props.draftKey);
      if (!current.text.trim() && current.attachments.length === 0)
        clearComposerDraft(props.draftKey);
    },
    [props.draftKey],
  );
  const send = async () => {
    if (!selection || inFlight.current || !canOperate || !isFocused) return null;
    const snapshot = getComposerDraftSnapshot(props.draftKey);
    if (!snapshot.text.trim() && !snapshot.attachments.length) return null;
    if (snapshot.attachments.length + (props.image ? 1 : 0) > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setError(copy.tooMany);
      return null;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const request = new AbortController();
    controller.current = request;
    const threadId = ThreadId.make(metadata.threadId);
    const messageId = MessageId.make(metadata.messageId);
    const image = props.image;
    return prepareImageGalleryMessage(
      {
        environmentId: props.environmentId,
        threadId,
        messageId,
        commandId: CommandId.make(metadata.commandId),
        createdAt: metadata.createdAt,
        text: snapshot.text.trim(),
        context: snapshot.context,
        attachments: snapshot.attachments,
        modelSelection: selection,
        runtimeMode,
        interactionMode,
        creation: {
          projectId: props.project.id,
          projectTitle: props.project.title,
          projectCwd: props.project.workspaceRoot,
          workspaceMode: "local",
          branch: null,
          worktreePath: null,
        },
      },
      image
        ? {
            signal: request.signal,
            prepare: () => prepareGalleryImage(props.environmentId, image, request.signal),
          }
        : null,
    )
      .then(async (message) => {
        if (!message || request.signal.aborted) return null;
        await enqueueThreadOutboxMessage(message);
        if (request.signal.aborted) return messageId;
        clearComposerDraftContent(props.draftKey, { deferAttachmentCleanup: true });
        props.onSent();
        selectDetail({ name: "Thread", params: { environmentId: props.environmentId, threadId } });
        return messageId;
      })
      .catch(() => {
        if (!request.signal.aborted) setError(copy.failed);
        return null;
      })
      .finally(() => {
        inFlight.current = false;
        if (!request.signal.aborted) setBusy(false);
      });
  };
  if (!selection)
    return <Text className="p-4 text-center text-foreground-muted">{copy.noModels}</Text>;
  const thread = draftThreadShell({
    environmentId: props.environmentId,
    projectId: props.project.id,
    threadId: ThreadId.make(metadata.threadId),
    modelSelection: selection,
    runtimeMode,
    interactionMode,
    branch: null,
    worktreePath: null,
    createdAt: metadata.createdAt,
  });
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
      {error ? (
        <Text accessibilityRole="alert" className="px-4 py-2 text-danger-foreground">
          {error}
        </Text>
      ) : null}
      <ThreadComposer
        isDraft
        canOperateThread={canOperate}
        placeholder={props.image ? copy.changes : copy.describe}
        selectedThread={thread}
        serverConfig={config}
        environmentId={props.environmentId}
        environmentLabel={null}
        connectionState="connected"
        projectCwd={props.project.workspaceRoot}
        draftKey={props.draftKey}
        hasCompactableConversation={false}
        queueCount={0}
        activeThreadBusy={false}
        canStopThread={false}
        followUpBehavior="queue"
        canSteerActiveTurn={false}
        hidden={false}
        canSwitchProvider
        interactionLocked={busy}
        bottomInset={keyboardVisible ? 0 : Math.max(insets.bottom, props.bottomInset)}
        onHeightChange={props.onHeightChange}
        onChangeDraftMessage={(text) => setComposerDraftText(props.draftKey, text)}
        {...actions}
        onRemoveDraftImage={(id) => removeComposerDraftAttachment(props.draftKey, id)}
        onStopThread={() => {}}
        onResumeQueue={null}
        onSendMessage={send}
        onShowUsageLimits={() => {}}
        modelControl={
          <Menu
            accessibilityLabel={copy.models}
            actions={[
              ...models.map((option) => ({
                id: option.key,
                title: option.label,
                state: option.key === selected?.key ? ("on" as const) : ("off" as const),
              })),
              ...descriptors.map((descriptor) => ({
                id: `options:${descriptor.id}`,
                title: descriptor.label,
                subactions: optionChoices
                  .filter((choice) => choice.id === descriptor.id)
                  .map((choice) => ({
                    id: choice.key,
                    title: choice.title,
                    state:
                      descriptor.currentValue === choice.value ? ("on" as const) : ("off" as const),
                  })),
              })),
              {
                id: "permissions",
                title: copy.permissions,
                subactions: runtimeChoices.map((choice) => ({
                  id: choice.mode,
                  title:
                    choice.mode === "approval-required"
                      ? copy.approval
                      : choice.mode === "full-access"
                        ? copy.full
                        : choice.label,
                  state: runtimeMode === choice.mode ? ("on" as const) : ("off" as const),
                })),
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (busy) return;
              const model = models.find((option) => option.key === nativeEvent.event);
              if (model)
                updateComposerDraftSettings(props.draftKey, { modelSelection: model.selection });
              else {
                const option = optionChoices.find((choice) => choice.key === nativeEvent.event);
                if (option && selection) {
                  const descriptor = descriptors.find((entry) => entry.id === option.id);
                  const change =
                    descriptor?.type === "select" && typeof option.value === "string"
                      ? getTraitSelectChange(
                          { ...promptTraits, descriptors },
                          descriptor,
                          draft.text,
                          option.value,
                        )
                      : null;
                  if (change && change.prompt !== draft.text)
                    setComposerDraftText(props.draftKey, change.prompt);
                  const options =
                    change && "modelOptions" in change
                      ? change.modelOptions
                      : applyProviderOptionSelection(descriptors, {
                          id: option.id,
                          value: option.value,
                        });
                  if (options)
                    updateComposerDraftSettings(props.draftKey, {
                      modelSelection: { ...selection, options },
                    });
                }
                const mode = runtimeChoices.find(
                  (choice) => choice.mode === nativeEvent.event,
                )?.mode;
                if (mode) updateComposerDraftSettings(props.draftKey, { runtimeMode: mode });
              }
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.models}
              className="max-w-32 px-2 py-3"
              disabled={busy}
            >
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {selected?.label}
              </Text>
            </Pressable>
          </Menu>
        }
      />
    </KeyboardStickyView>
  );
}
