import { useLayoutEffect, useState } from "react";
import type { OrchestrationV2RunStatus, RunId } from "@t3tools/contracts";

import {
  EMPTY_SETTLED_TAIL_STATE,
  observeSettledTail,
  type SettledTurnState,
} from "./workingPetAnimation";

// Arm before paint so a settling turn keeps its working row for the terminal pet animation.
export function useWorkingRowSettledTail(input: {
  /** Environment-scoped thread key. Thread IDs are only unique within an environment. */
  readonly threadKey: string | null;
  readonly latestTurnId: RunId | null;
  readonly latestTurnState: OrchestrationV2RunStatus | null;
  readonly isWorking: boolean;
  readonly latestTurnSettled: boolean;
}): SettledTurnState | null {
  const [tail, setTail] = useState(EMPTY_SETTLED_TAIL_STATE);
  const key = JSON.stringify([input.threadKey, input.latestTurnId]);
  const settledTurnState: SettledTurnState | null =
    input.latestTurnState === "completed" ||
    input.latestTurnState === "failed" ||
    input.latestTurnState === "cancelled"
      ? input.latestTurnState === "failed"
        ? "error"
        : input.latestTurnState === "cancelled"
          ? "interrupted"
          : "completed"
      : null;
  const settledNow = input.latestTurnSettled && !input.isWorking && settledTurnState !== null;

  // oxlint-disable-next-line t3code/react-effect-budget -- Observe the external run settling before paint to retain the terminal animation row.
  useLayoutEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- Arm the terminal animation before paint when the external run settles.
    setTail((current) =>
      observeSettledTail(current, { key, settled: settledNow, settledTurnState }, Date.now()),
    );
  }, [key, settledNow, settledTurnState]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Own and release the timeout that ends the terminal pet animation.
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
