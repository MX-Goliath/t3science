import type { DesktopPetAnimationState } from "@t3tools/contracts";

/** Turn states that end a turn — OrchestrationLatestTurnState minus "running". */
export type SettledTurnState = "completed" | "error" | "interrupted";

/** How long the working row (and its pet) lingers after the turn settles. */
export const WORKING_ROW_SETTLED_TAIL_MS = 3_000;

/** Terminal pet animation per settled turn state. */
export const SETTLED_TURN_PET_ANIMATION: Readonly<
  Record<SettledTurnState, DesktopPetAnimationState>
> = {
  completed: "jumping",
  error: "failed",
  interrupted: "waving",
};

/**
 * Pet animation for the working row. Precedence: checkpoint revert > settled
 * turn state > waiting on the user (a question or command approval) > active
 * work.
 */
export function resolveWorkingPetAnimation(input: {
  readonly isRevertingCheckpoint: boolean;
  readonly settledTurnState: SettledTurnState | null;
  readonly isWaitingForUser: boolean;
}): DesktopPetAnimationState {
  if (input.isRevertingCheckpoint) return "review";
  if (input.settledTurnState !== null) return SETTLED_TURN_PET_ANIMATION[input.settledTurnState];
  if (input.isWaitingForUser) return "waiting";
  return "running";
}

// ---------------------------------------------------------------------------
// Settled tail — the working row lingers after the active turn settles so the
// pet can play its terminal animation. The lifecycle below is pure: the hook
// applies one observation per relevant change (in a layout effect, so the
// settled row never drops out for a painted frame) and a timeout expires it.
// ---------------------------------------------------------------------------

export interface SettledTailObservation {
  /** "threadId:turnId" — the observation's scope. */
  readonly key: string;
  /** The observed turn is settled and no work is in flight. */
  readonly settled: boolean;
  readonly settledTurnState: SettledTurnState | null;
}

export interface SettledTailState {
  readonly previous: SettledTailObservation | null;
  readonly active: SettledTurnState | null;
  readonly expiresAt: number | null;
}

export const EMPTY_SETTLED_TAIL_STATE: SettledTailState = {
  previous: null,
  active: null,
  expiresAt: null,
};

function isSettledTailActive(state: SettledTailState, now: number): boolean {
  return state.active !== null && state.expiresAt !== null && state.expiresAt > now;
}

/**
 * Fold one observation into the tail state. A tail arms exactly when the same
 * thread+turn is observed transitioning from unsettled to settled — never on
 * the first observation of an already-settled turn (mount, thread switch) —
 * and stays armed until `expiresAt` or until a newer observation (work,
 * turn, or thread change) arrives. Unchanged observations return the same
 * state reference so the hook can bail out without sliding the timer.
 */
export function observeSettledTail(
  state: SettledTailState,
  observation: SettledTailObservation,
  now: number,
): SettledTailState {
  const stillActive = isSettledTailActive(state, now);
  const freshSettle =
    observation.settled &&
    observation.settledTurnState !== null &&
    state.previous !== null &&
    state.previous.key === observation.key &&
    state.previous.settled === false;
  // The tail survives only unchanged observations (effect re-runs, store
  // churn); any newer work, turn, or thread switch disarms it early.
  const observationUnchanged =
    state.previous !== null &&
    state.previous.key === observation.key &&
    state.previous.settled === observation.settled;
  const active = freshSettle
    ? observation.settledTurnState
    : stillActive && observationUnchanged
      ? state.active
      : null;
  const expiresAt = freshSettle
    ? now + WORKING_ROW_SETTLED_TAIL_MS
    : stillActive
      ? state.expiresAt
      : null;
  if (
    state.previous !== null &&
    state.previous.key === observation.key &&
    state.previous.settled === observation.settled &&
    active === state.active &&
    expiresAt === state.expiresAt
  ) {
    return state;
  }
  return { previous: observation, active, expiresAt };
}
