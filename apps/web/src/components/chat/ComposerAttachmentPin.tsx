import { PinIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "../../composerDraftStore";
import { readLocalApi } from "../../localApi";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ComposerAttachmentPinning {
  readonly pinnedIds: ReadonlyArray<string>;
  readonly onContextMenu: (attachmentId: string, event: MouseEvent<HTMLElement>) => void;
}

export async function showComposerAttachmentPinMenu(
  target: ComposerThreadTarget,
  attachmentId: string,
  event: MouseEvent<HTMLElement>,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  const api = readLocalApi();
  if (!api) return;
  const pinned =
    useComposerDraftStore
      .getState()
      .getComposerDraft(target)
      ?.pinnedAttachmentIds?.includes(attachmentId) ?? false;
  const bounds = event.currentTarget.getBoundingClientRect();
  const position =
    event.clientX === 0 && event.clientY === 0
      ? { x: bounds.left, y: bounds.bottom }
      : { x: event.clientX, y: event.clientY };
  try {
    const selected = await api.contextMenu.show(
      [{ id: "toggle-pin", label: pinned ? "Unpin attachment" : "Pin attachment" }],
      position,
    );
    if (selected === "toggle-pin") {
      useComposerDraftStore.getState().setAttachmentPinned(target, attachmentId, !pinned);
    }
  } catch {
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not open attachment menu" }),
    );
  }
}

export function ComposerAttachmentPin({ small = false }: { readonly small?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Pinned attachment"
            className={
              small
                ? "absolute left-0.5 top-0.5 z-10 inline-flex rounded-sm bg-background/90 p-px text-foreground shadow-sm"
                : "absolute left-1 top-1 z-10 inline-flex rounded bg-background/90 p-0.5 text-foreground shadow-sm"
            }
          />
        }
      >
        <PinIcon aria-hidden="true" className={small ? "size-2" : "size-3"} />
      </TooltipTrigger>
      <TooltipPopup>Sent with every message until unpinned</TooltipPopup>
    </Tooltip>
  );
}
