import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { LegendListRef } from "@legendapp/list/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessagesTimelineHistoryControls } from "./MessagesTimeline";
import type { TimelineViewport } from "./timelineViewport";
import { startTimelinePositionRestore } from "./useTimelinePositionRestore";

interface MessageNavigation {
  readonly threadKey: string;
  readonly messageId: string;
  readonly id: number;
}
const useMessageNavigationStore = create<{ request: MessageNavigation | null; revision: number }>(
  () => ({
    request: null,
    revision: 0,
  }),
);

export function requestThreadMessageNavigation(thread: ScopedThreadRef, messageId: string) {
  useMessageNavigationStore.setState((state) => ({
    revision: state.revision + 1,
    request: { threadKey: scopedThreadKey(thread), messageId, id: state.revision + 1 },
  }));
}
export function usePendingThreadMessage(threadKey: string) {
  return useMessageNavigationStore((state) =>
    state.request?.threadKey === threadKey ? state.request : null,
  );
}

export function retainThreadMessageNavigation(input: {
  modalPage: boolean;
  threadRef: ScopedThreadRef | null;
}) {
  if (input.modalPage) return;
  const shown = input.threadRef ? scopedThreadKey(input.threadRef) : null;
  useMessageNavigationStore.setState((state) =>
    state.request && state.request.threadKey !== shown ? { request: null } : state,
  );
}

export function useThreadMessageNavigation(input: {
  request: MessageNavigation | null;
  ready: boolean;
  rowIndex: number;
  firstEntryId: string | undefined;
  history: MessagesTimelineHistoryControls | undefined;
  list: React.RefObject<LegendListRef | null>;
  viewport: React.RefObject<TimelineViewport | null>;
}) {
  const requestedPage = useRef<string | null>(null);
  const { request, ready, rowIndex, firstEntryId, history, list, viewport } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pages and positions the virtual list for an explicit message navigation request
  useEffect(() => {
    if (!request || !ready || !list.current || !viewport.current) return;
    if (rowIndex < 0) {
      if (history?.loading !== true && !history?.hasMoreHistory && !history?.error) {
        useMessageNavigationStore.setState((state) =>
          state.request?.id === request.id ? { request: null } : state,
        );
        return;
      }
      if (!history?.hasMoreHistory || history.loading || history.error) return;
      const page = `${request.id}:${firstEntryId ?? "first"}`;
      if (requestedPage.current === page) return;
      requestedPage.current = page;
      history.onLoadEarlier(request.messageId);
      return;
    }
    return startTimelinePositionRestore({
      list: list.current,
      viewport: viewport.current,
      listIdentityKey: request.threadKey,
      listOpenedOn: request.threadKey,
      citationPending: false,
      releaseForFind: true,
      rememberedPosition: {
        rowId: request.messageId,
        offsetWithinRow: 0,
        scrollOffset: 0,
        atEnd: false,
      },
      onPositioned: () =>
        useMessageNavigationStore.setState((state) =>
          state.request?.id === request.id ? { request: null } : state,
        ),
    });
  }, [request, ready, rowIndex, firstEntryId, history, list, viewport]);
}
