import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import type {
  OrchestrationThread,
  OrchestrationThreadShell,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentThreadDetails } from "./state/threads";
import type { ThreadNotificationKind } from "./threadNotificationContent";

/** Subscribe only for a pending alert; reuse the loaded detail and release it on delivery. */
export function watchThreadNotificationDetail(
  ref: ScopedThreadRef,
  expected: Pick<OrchestrationThreadShell, "latestTurn">,
  kind: ThreadNotificationKind,
  onReady: (detail: OrchestrationThread | null) => void,
) {
  const atom = environmentThreadDetails.stateAtom(ref);
  let stopped = false;
  let unsubscribe = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
  const inspect = () => {
    if (stopped) return;
    const state = appAtomRegistry.get(atom);
    const detail = Option.getOrNull(state.data);
    if (state.status !== "deleted" && Option.isNone(state.error)) {
      if (state.status !== "live" || !detail) return;
      if (detail.latestTurn?.turnId !== expected.latestTurn?.turnId) return;
      if (kind === "done" && detail.latestTurn?.state !== "completed") return;
      if (
        kind === "error" &&
        detail.latestTurn?.state !== "error" &&
        detail.session?.status !== "error"
      )
        return;
      if (kind === "input" && derivePendingRequests(detail.activities).userInputs.length === 0)
        return;
      if (kind === "approval" && derivePendingRequests(detail.activities).approvals.length === 0)
        return;
    }
    stop();
    onReady(detail);
  };
  unsubscribe = appAtomRegistry.subscribe(atom, inspect);
  if (stopped) unsubscribe();
  else inspect();
  return stop;
}
