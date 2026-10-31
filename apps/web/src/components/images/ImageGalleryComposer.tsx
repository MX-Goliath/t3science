import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Navigate } from "@tanstack/react-router";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type EnvironmentId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { providersIgnoringCheckedAtAtom } from "~/state/server";
import { prepareImageGalleryAttachment } from "./prepareImageGalleryAttachment";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import type { GalleryImage } from "./imageGalleryTypes";
import { ImageGalleryContent } from "./ImageGalleryContent";
import { imageLibraryCopy } from "./imageLibraryCopy";
import { discardUneditedImageDraft, openImageGalleryDraft } from "./imageGalleryDraft";

export function ImageGalleryComposer(props: {
  environmentId: EnvironmentId;
  image: GalleryImage | null;
  content: React.ReactNode;
  onRetry: () => void;
}) {
  const { openScratchProject } = useScratchProject();
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(props.environmentId));
  const [draftId, setDraftId] = useState<DraftId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = imageLibraryCopy();
  const image = props.image;
  const scope = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState(false);
  const refreshAsset = useAssetUrlRefresh(
    props.environmentId,
    image ? { _tag: "draft-workspace-file", cwd: image.directory, path: image.fileName } : null,
  );
  const failure = error;
  const session = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const promoted = useComposerDraftStore((store) =>
    draftId ? store.getPromotedDraftRedirect(draftId) : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases an unedited source attachment when its viewer closes
  useEffect(
    () => () => {
      if (draftId && image) discardUneditedImageDraft(draftId, image.fileName);
    },
    [draftId, image],
  );
  const start = useEffectEvent(
    async (signal: AbortSignal, environmentId: EnvironmentId, sourceId: string | undefined) => {
      const project = await openScratchProject(environmentId, copy.noComposer).catch(() => null);
      if (!project || signal.aborted) {
        if (!signal.aborted) setError(copy.noComposer);
        return;
      }
      const codex =
        providers.find(
          (provider) =>
            provider.driver === "codex" &&
            provider.enabled &&
            provider.instanceId === image?.providerInstanceId,
        ) ?? providers.find((provider) => provider.driver === "codex" && provider.enabled);
      const model = codex?.models[0];
      setDraftId(
        openImageGalleryDraft(
          scopeProjectRef(environmentId, project.id),
          sourceId ?? null,
          codex && model ? { instanceId: codex.instanceId, model: model.slug, options: [] } : null,
        ),
      );
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens isolated scratch state for this gallery composer and ignores results after navigation
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    // oxlint-disable-next-line react/set-state-in-effect -- acquiring scratch state starts a server command and updates state after its response
    void start(controller.signal, props.environmentId, image?.id);
    return () => {
      controller.abort();
      if (scope.current === controller) scope.current = null;
    };
  }, [props.environmentId, image?.id]);
  const prepareSendImages = async (attachmentCount: number) => {
    if (!image) return [];
    const signal = scope.current?.signal;
    if (!signal || signal.aborted) return null;
    if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
      throw new Error(copy.attachmentFailed);
    setPreparing(true);
    return refreshAsset()
      .then(async (url) => {
        if (!url) throw new Error(copy.attachmentFailed);
        const attachment = await prepareImageGalleryAttachment(image, url, signal);
        return signal.aborted ? null : [attachment];
      })
      .catch(() => {
        if (signal.aborted) return null;
        throw new Error(copy.attachmentFailed);
      })
      .finally(() => {
        if (!signal.aborted) setPreparing(false);
      });
  };
  if (promoted)
    return (
      <Navigate
        to="/$environmentId/$threadId"
        params={{ environmentId: promoted.environmentId, threadId: promoted.threadId }}
      />
    );
  if (!session || !draftId || failure)
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {props.content}
        <div
          role="status"
          className="absolute inset-x-4 bottom-8 rounded-xl bg-card p-4 text-center text-sm text-muted-foreground"
        >
          {failure ?? copy.preparing}
          {failure ? (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void refreshAsset().then(props.onRetry, props.onRetry);
                }}
              >
                {copy.retry}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  return (
    <ChatView
      routeKind="draft"
      environmentId={props.environmentId}
      threadId={session.threadId}
      draftId={draftId}
      presentation={{
        content: <ImageGalleryContent>{props.content}</ImageGalleryContent>,
        collapseWhenUnfocused: true,
        placeholder: image ? copy.changes : copy.describe,
        preparing,
        prepareSendImages,
      }}
    />
  );
}
