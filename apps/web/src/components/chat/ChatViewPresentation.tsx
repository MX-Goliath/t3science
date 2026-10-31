import type { ComponentProps, ReactNode } from "react";
import type { ComposerImageAttachment } from "~/composerDraftStore";
import { ThreadTimeline } from "./ThreadTimeline";

export interface ChatViewPresentation {
  content: ReactNode;
  collapseWhenUnfocused?: boolean | undefined;
  placeholder: string;
  preparing: boolean;
  prepareSendImages?:
    | ((attachmentCount: number) => Promise<ReadonlyArray<ComposerImageAttachment> | null>)
    | undefined;
}

export function ChatViewHeader({
  presentation,
  ...props
}: ComponentProps<"header"> & { presentation: ChatViewPresentation | undefined }) {
  return presentation ? null : <header {...props} />;
}

export function ChatViewTimeline({
  presentation,
  ...props
}: ComponentProps<typeof ThreadTimeline> & { presentation: ChatViewPresentation | undefined }) {
  return presentation ? presentation.content : <ThreadTimeline {...props} />;
}
