import { useLayoutEffect, useState } from "react";
import type { OrchestrationLatestTurnState, TurnId } from "@t3tools/contracts";

import {
  EMPTY_SETTLED_TAIL_STATE,
  observeSettledTail,
  type SettledTurnState,
} from "./workingPetAnimation";

/**
 * The working row's settled tail: the terminal animation (jump / fail / wave)
 * shown for WORKING_ROW_SETTLED_TAIL_MS after the active thread's latest turn
 * settles, then the row goes away.
 *
 * The arming observation is applied in a layout effect, before paint, so the
 * settled row never drops out for a frame between the turn completing and the
 * tail taking over. The tail arms only for a turn observed settling in this
 * view — navigating to a thread whose turn already settled stays folded.
 */
export function useWorkingRowSettledTail(input: {
  /** Environment-scoped thread key. Thread IDs are only unique within an environment. */
  readonly threadKey: string | null;
  readonly latestTurnId: TurnId | null;
  readonly latestTurnState: OrchestrationLatestTurnState | null;
  readonly isWorking: boolean;
  readonly latestTurnSettled: boolean;
}): SettledTurnState | null {
  const [tail, setTail] = useState(EMPTY_SETTLED_TAIL_STATE);
  const key = JSON.stringify([input.threadKey, input.latestTurnId]);
  const settledTurnState: SettledTurnState | null =
    input.latestTurnState === "completed" ||
    input.latestTurnState === "error" ||
    input.latestTurnState === "interrupted"
      ? input.latestTurnState
      : null;
  const settledNow = input.latestTurnSettled && !input.isWorking && settledTurnState !== null;

  useLayoutEffect(() => {
    setTail((current) =>
      observeSettledTail(current, { key, settled: settledNow, settledTurnState }, Date.now()),
    );
  }, [key, settledNow, settledTurnState]);

  useLayoutEffect(() => {
    if (tail.active === null || tail.expiresAt === null) {
      return;
    }
    const id = setTimeout(
      () =>
        setTail((current) =>
          current.active === null ? current : { ...current, active: null, expiresAt: null },
        ),
      Math.max(0, tail.expiresAt - Date.now()),
    );
    return () => clearTimeout(id);
  }, [tail]);

  return tail.active;
}
