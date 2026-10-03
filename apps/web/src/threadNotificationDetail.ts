import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ThreadProjection, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentThreadDetails } from "./state/threads";
import type { ThreadNotificationKind } from "./threadNotificationContent";

/** Subscribe only for a pending alert; reuse the loaded detail and release it on delivery. */
export function watchThreadNotificationDetail(
  ref: ScopedThreadRef,
  expected: Pick<EnvironmentThreadShell, "latestRun">,
  kind: ThreadNotificationKind,
  onReady: (detail: OrchestrationV2ThreadProjection | null) => void,
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
      const run = detail.runs.find((run) => run.id === expected.latestRun?.runId);
      if (!run) return;
      if (kind === "done" && run.status !== "completed") return;
      if (kind === "error" && run.status !== "failed") return;
      if (
        kind === "input" &&
        !detail.turnItems.some(
          (item) =>
            item.runId === run.id &&
            item.type === "user_input_request" &&
            item.status !== "completed",
        )
      )
        return;
      if (
        kind === "approval" &&
        !detail.turnItems.some(
          (item) =>
            item.runId === run.id &&
            item.type === "approval_request" &&
            item.status !== "completed",
        )
      )
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
