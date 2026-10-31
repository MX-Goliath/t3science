import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from "lucide-react";
import type { ImageLibraryEntry } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { imageLibraryConversation } from "~/state/imageLibrary";
import { useAssetUrlState } from "~/assets/assetUrls";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { isElectron } from "~/env";
import { Button } from "../ui/button";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { requestThreadMessageNavigation } from "../chat/threadMessageNavigation";
import { ImageViewport } from "./ImageViewport";
import { ImageSourceConversation } from "./ImageSourceConversation";
import type { ImageSelection } from "./imageGalleryTypes";
import { imageLibraryCopy } from "./imageLibraryCopy";

export function ImageViewer(props: {
  selection: ImageSelection;
  onSelect: (selection: ImageSelection | null) => void;
  showConversation: boolean;
  onShowConversation: () => void;
  onHideConversation: () => void;
}) {
  const { image, siblings } = props.selection;
  const copy = imageLibraryCopy();
  const navigate = useNavigate();
  const [zoom, setZoom] = useState(1);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const resolveConversation = useAtomQueryRunner(imageLibraryConversation, {
    reportFailure: false,
  });
  const asset = useAssetUrlState(image.environmentId, {
    _tag: "draft-workspace-file",
    cwd: image.directory,
    path: image.fileName,
  });
  const index = siblings.findIndex((entry) => entry.id === image.id);
  const move = (delta: number) => {
    const next = siblings[index + delta];
    if (next) {
      setZoom(1);
      props.onSelect({ image: next, siblings });
    }
  };
  const openOrigin = (origin: NonNullable<ImageLibraryEntry["origin"]>) => {
    if (!origin.messageId) return;
    const ref = scopeThreadRef(image.environmentId, origin.threadId);
    requestThreadMessageNavigation(ref, origin.messageId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: image.environmentId, threadId: origin.threadId },
    });
  };
  const conversation = async () => {
    if (opening) return;
    if (image.origin?.messageId) {
      openOrigin(image.origin);
      return;
    }
    if (!image.origin) {
      props.onShowConversation();
      return;
    }
    const signal = scope.current?.signal;
    if (!signal) return;
    setOpening(true);
    const result = await resolveConversation({
      environmentId: image.environmentId,
      input: { id: image.id },
    });
    if (signal.aborted) return;
    setOpening(false);
    if (result._tag === "Success" && result.value.origin?.messageId)
      openOrigin(result.value.origin);
    else props.onShowConversation();
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,[contenteditable=true]"))
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      props.onSelect(null);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gallery shortcuts are active while the image viewer is mounted
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      controller.abort();
      if (scope.current === controller) scope.current = null;
    };
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspacePageHeader electron={isElectron}>
        <div className="flex min-w-0 flex-1 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index <= 0}
            aria-label={copy.previous}
            onClick={() => move(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index >= siblings.length - 1}
            aria-label={copy.next}
            onClick={() => move(1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button variant="ghost" size="sm" disabled={opening} onClick={() => void conversation()}>
            {opening ? copy.opening : copy.conversation}
          </Button>
          <div className="flex-1" />
          <div className="hidden items-center sm:flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copy.zoomOut}
              disabled={zoom <= 1}
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
            >
              −
            </Button>
            <Button variant="ghost" size="sm" aria-label={copy.fit} onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copy.zoomIn}
              disabled={zoom >= 4}
              onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
            >
              +
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copy.download}
            disabled={asset._tag !== "Success"}
            onClick={() => {
              if (asset._tag !== "Success") return;
              void fetch(asset.url)
                .then((response) => {
                  if (!response.ok) throw new Error(copy.failed);
                  return response.blob();
                })
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = image.fileName;
                  link.click();
                  URL.revokeObjectURL(url);
                })
                .catch(() => setDownloadFailed(true));
            }}
          >
            <DownloadIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copy.close}
            onClick={() => props.onSelect(null)}
          >
            <XIcon />
          </Button>
        </div>
      </WorkspacePageHeader>
      {downloadFailed ? (
        <p role="alert" className="px-4 text-sm text-destructive">
          {copy.failed}
        </p>
      ) : null}
      {props.showConversation ? (
        <ImageSourceConversation image={image} onBack={props.onHideConversation} />
      ) : asset._tag === "Success" ? (
        <ImageViewport
          key={image.id}
          src={asset.url}
          name={image.fileName}
          zoom={zoom}
          onZoomChange={setZoom}
          label={copy.viewport}
        />
      ) : (
        <p className="min-h-0 flex-1 py-16 text-center text-muted-foreground">
          {asset._tag === "Failure" ? copy.failed : copy.loading}
        </p>
      )}
    </div>
  );
}
