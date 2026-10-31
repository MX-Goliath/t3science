import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  EnvironmentId,
  type ImageLibraryEntry,
  type ImageLibraryConversation,
} from "@t3tools/contracts";
import { createShellEnvironmentAtoms } from "@t3tools/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { imageGalleryResetRevision } from "../../state/imageGalleryNavigation";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useAssetUrlState } from "../../state/assets";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { imageLibraryConversation } from "../../state/imageLibrary";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { requestThreadMessageJump } from "../threads/threadMessageJump";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { AppText as Text } from "../../components/ui/AppText";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { AppBar } from "../../components/ui/AppBar";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import * as Dialog from "../../components/ui/Dialog";
import { ImageGalleryGrid } from "./ImageGalleryGrid";
import { ImageGalleryViewport } from "./ImageGalleryViewport";
import { ImageGalleryComposer } from "./ImageGalleryComposer";
import { imageResource, saveGalleryImage } from "./imageGalleryFiles";
import { imageLibraryCopy } from "./imageLibraryCopy";

const shell = createShellEnvironmentAtoms(connectionAtomRuntime);

export function ImagesScreen(props: { workspace?: boolean }) {
  const copy = imageLibraryCopy();
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments().filter(
    (environment) => environment.isEnabled && environment.connectionState === "connected",
  );
  const [chosenEnvironment, setChosenEnvironment] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((entry) => entry.environmentId === chosenEnvironment) ?? environments[0];
  const environmentId = environment?.environmentId ?? null;
  const [selection, setSelection] = useState<{
    environmentId: EnvironmentId;
    image: ImageLibraryEntry;
    siblings: readonly ImageLibraryEntry[];
  } | null>(null);
  const [conversation, setConversation] = useState<ImageLibraryConversation | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [composerHeight, setComposerHeight] = useState(80);
  const [composerAttempt, setComposerAttempt] = useState(0);
  const revision = useAtomValue(imageGalleryResetRevision);
  const [previousRevision, setPreviousRevision] = useState(revision);
  if (revision !== previousRevision) {
    setPreviousRevision(revision);
    setSelection(null);
    setConversation(null);
  }
  const selected = selection?.environmentId === environmentId ? selection : null;
  const image = selected?.image ?? null;
  const asset = useAssetUrlState(environmentId, image ? imageResource(image) : null);
  const resolveConversation = useAtomQueryRunner(imageLibraryConversation, {
    reportFailure: false,
  });
  const canOpenDirectory = useAtomValue(shell.openInEditor.permissionAtom(environmentId));
  const openDirectory = useAtomCommand(shell.openInEditor, { reportFailure: false });
  const controller = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels file actions when their owning image or environment changes
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    return () => request.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- each image and environment owns a separate cancellation scope
  }, [image?.id, environmentId]);
  const chooseImage = (next: ImageLibraryEntry, siblings: readonly ImageLibraryEntry[]) => {
    if (!environmentId) return;
    Keyboard.dismiss();
    setOpening(false);
    setSaving(false);
    setSelection({ environmentId, image: next, siblings });
    setConversation(null);
  };
  const move = (delta: number) => {
    if (!selected) return;
    const index = selected.siblings.findIndex((entry) => entry.id === image?.id);
    const next = selected.siblings[index + delta];
    if (next) chooseImage(next, selected.siblings);
  };
  const openOrigin = (origin: NonNullable<ImageLibraryEntry["origin"]>) => {
    if (!environmentId || !origin.messageId) return;
    requestThreadMessageJump(scopedThreadKey(environmentId, origin.threadId), origin.messageId);
    selectDetail({ name: "Thread", params: { environmentId, threadId: origin.threadId } });
  };
  const openConversation = async () => {
    if (!image || !environmentId || opening) return;
    if (image.origin?.messageId) {
      openOrigin(image.origin);
      return;
    }
    const signal = controller.current?.signal;
    setOpening(true);
    const result = await resolveConversation({ environmentId, input: { id: image.id } });
    if (signal?.aborted) return;
    setOpening(false);
    if (result._tag !== "Success") {
      Dialog.alert(copy.failed);
      return;
    }
    if (result.value.origin?.messageId) openOrigin(result.value.origin);
    else setConversation(result.value);
  };
  const save = async () => {
    const signal = controller.current?.signal;
    if (!image || !environmentId || !signal || saving) return;
    setSaving(true);
    await saveGalleryImage(environmentId, image, signal)
      .then(() => {
        if (!signal.aborted) Dialog.alert(copy.saved);
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !/cancel/i.test(String(error))) Dialog.alert(copy.failed);
      })
      .finally(() => {
        if (!signal.aborted) setSaving(false);
      });
  };
  const index = selected?.siblings.findIndex((entry) => entry.id === image?.id) ?? -1;
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={image ? image.fileName : copy.mine}
        sidebar={false}
        options={{ headerBackVisible: !props.workspace }}
        onBack={() => {
          if (conversation) setConversation(null);
          else if (image) setSelection(null);
          else if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate("Home");
        }}
        actions={
          image
            ? [
                {
                  accessibilityLabel: copy.conversation,
                  icon: "text.bubble",
                  disabled: opening,
                  onPress: () => void openConversation(),
                },
                {
                  accessibilityLabel: copy.save,
                  icon: "arrow.down",
                  disabled: saving,
                  onPress: () => void save(),
                },
                {
                  accessibilityLabel: copy.close,
                  icon: "xmark",
                  onPress: () => {
                    setSelection(null);
                    setConversation(null);
                  },
                },
              ]
            : []
        }
      />
      {environments.length > 1 && !image ? (
        <Menu
          accessibilityLabel={environment?.environmentLabel ?? "Environment"}
          actions={environments.map((entry) => ({
            id: entry.environmentId,
            title: entry.environmentLabel,
          }))}
          onPressAction={({ nativeEvent }) => {
            setChosenEnvironment(EnvironmentId.make(nativeEvent.event));
            setSelection(null);
          }}
        >
          <Pressable className="px-4 py-3">
            <Text className="text-foreground-muted">{environment?.environmentLabel} ▾</Text>
          </Pressable>
        </Menu>
      ) : null}
      <View className="flex-1">
        {!environmentId ? (
          <Text className="p-8 text-center text-foreground-muted">{copy.offline}</Text>
        ) : conversation ? (
          <ImageConversation conversation={conversation} bottomInset={composerHeight + 24} />
        ) : image ? (
          <>
            <View className="flex-row justify-between px-3 py-2">
              <Button
                label="‹"
                accessibilityLabel={copy.previous}
                disabled={index <= 0}
                onPress={() => move(-1)}
              />
              <Button
                label="›"
                accessibilityLabel={copy.next}
                disabled={index >= (selected?.siblings.length ?? 0) - 1}
                onPress={() => move(1)}
              />
            </View>
            <View className="flex-1" style={{ paddingBottom: composerHeight }}>
              {asset._tag === "Success" ? (
                <ImageGalleryViewport key={image.id} uri={asset.url} />
              ) : (
                <Text className="p-8 text-center text-foreground-muted">
                  {asset._tag === "Failure" ? copy.failed : copy.loading}
                </Text>
              )}
            </View>
          </>
        ) : (
          <ImageGalleryGrid
            key={environmentId}
            environmentId={environmentId}
            bottomInset={composerHeight + 24}
            onBrowse={Keyboard.dismiss}
            onSelect={chooseImage}
            canOpenDirectory={canOpenDirectory}
            onOpenDirectory={(path) => {
              void openDirectory({
                environmentId,
                input: { cwd: path, editor: "file-manager" },
              }).then((result) => {
                if (result._tag === "Failure") Dialog.alert(copy.failed);
              });
            }}
          />
        )}
        {environmentId ? (
          <View className="absolute inset-x-0 bottom-0">
            <ImageGalleryComposer
              key={`${environmentId}:${image?.id ?? "new"}:${composerAttempt}`}
              environmentId={environmentId}
              image={image}
              onHeightChange={setComposerHeight}
              bottomInset={props.workspace ? (workspace?.bottomClearance ?? 0) : 0}
              onSent={() => setComposerAttempt((attempt) => attempt + 1)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ImageConversation({
  conversation,
  bottomInset,
}: {
  conversation: ImageLibraryConversation;
  bottomInset: number;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const copy = imageLibraryCopy();
  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomInset }}
      keyboardDismissMode="on-drag"
    >
      {conversation.messages.map((message, index) => (
        <View
          key={`${message.createdAt}:${message.role}:${message.text}`}
          onLayout={
            index === conversation.imageMessageIndex
              ? (event) =>
                  scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false })
              : undefined
          }
          className="mb-4 rounded-xl bg-subtle p-3"
        >
          <Text className="mb-2 text-xs text-foreground-muted">
            {message.role === "user" ? copy.user : copy.assistant}
          </Text>
          <Text selectable>{message.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
