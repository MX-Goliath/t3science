import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SETTLED_TAIL_STATE,
  SETTLED_TURN_PET_ANIMATION,
  WORKING_ROW_SETTLED_TAIL_MS,
  observeSettledTail,
  resolveWorkingPetAnimation,
  type SettledTailObservation,
  type SettledTailState,
  type SettledTurnState,
} from "./workingPetAnimation";

describe("resolveWorkingPetAnimation", () => {
  const base = {
    isRevertingCheckpoint: false,
    settledTurnState: null,
    isWaitingForUser: false,
  };

  it("defaults to running work", () => {
    expect(resolveWorkingPetAnimation(base)).toBe("running");
  });

  it("shows waiting while the turn is blocked on the user", () => {
    expect(resolveWorkingPetAnimation({ ...base, isWaitingForUser: true })).toBe("waiting");
  });

  it("shows the terminal animation for each settled turn state", () => {
    expect(resolveWorkingPetAnimation({ ...base, settledTurnState: "completed" })).toBe(
      SETTLED_TURN_PET_ANIMATION.completed,
    );
    expect(resolveWorkingPetAnimation({ ...base, settledTurnState: "error" })).toBe("failed");
    expect(resolveWorkingPetAnimation({ ...base, settledTurnState: "interrupted" })).toBe("waving");
  });

  it("prefers the settled state over a still-pending user request", () => {
    expect(
      resolveWorkingPetAnimation({ ...base, settledTurnState: "error", isWaitingForUser: true }),
    ).toBe("failed");
  });

  it("prefers the checkpoint revert over everything", () => {
    expect(
      resolveWorkingPetAnimation({
        ...base,
        isRevertingCheckpoint: true,
        settledTurnState: "completed",
        isWaitingForUser: true,
      }),
    ).toBe("review");
  });

  it("keeps a 3s settled tail", () => {
    expect(WORKING_ROW_SETTLED_TAIL_MS).toBe(3_000);
  });
});

describe("observeSettledTail", () => {
  const TURN_1 = "thread-a:turn-1";
  const TURN_2 = "thread-a:turn-2";
  const TURN_B = "thread-b:turn-9";

  const observation = (
    key: string,
    settled: boolean,
    settledTurnState: SettledTurnState | null = null,
  ): SettledTailObservation => ({ key, settled, settledTurnState });

  const observe = (
    state: SettledTailState,
    observationInput: SettledTailObservation,
    now: number,
  ): SettledTailState => observeSettledTail(state, observationInput, now);

  it("does not tail a turn that is already settled on first observation", () => {
    // Mount or thread switch onto a thread whose turn settled long ago.
    const state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_B, true, "completed"), 10_000);
    expect(state.active).toBeNull();
  });

  it("arms the tail when the observed turn settles, and only then", () => {
    const running = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 10_000);
    expect(running.active).toBeNull();

    const settled = observe(running, observation(TURN_1, true, "completed"), 20_000);
    expect(settled.active).toBe("completed");
    expect(settled.expiresAt).toBe(20_000 + WORKING_ROW_SETTLED_TAIL_MS);
  });

  it("arms the settled turn state per outcome", () => {
    const running = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);

    expect(observe(running, observation(TURN_1, true, "error"), 1_000).active).toBe("error");
    expect(observe(running, observation(TURN_1, true, "interrupted"), 1_000).active).toBe(
      "interrupted",
    );
    // ...which the resolver maps to the terminal animations.
    expect(SETTLED_TURN_PET_ANIMATION.error).toBe("failed");
    expect(SETTLED_TURN_PET_ANIMATION.interrupted).toBe("waving");
  });

  it("stays armed until the deadline without sliding the timer", () => {
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);
    state = observe(state, observation(TURN_1, true, "completed"), 1_000);
    const expiresAt = state.expiresAt;

    // Repeated identical observations (effect re-runs, store churn) keep the
    // same state reference so the hook bails out and the timer does not slide.
    const repeated = observe(state, observation(TURN_1, true, "completed"), 2_000);
    expect(repeated).toBe(state);

    const beforeDeadline = observe(state, observation(TURN_1, true, "completed"), expiresAt! - 1);
    expect(beforeDeadline.active).toBe("completed");

    const atDeadline = observe(state, observation(TURN_1, true, "completed"), expiresAt!);
    expect(atDeadline.active).toBeNull();
  });

  it("disarms on newer work in the same turn", () => {
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);
    state = observe(state, observation(TURN_1, true, "completed"), 1_000);
    expect(state.active).toBe("completed");

    // A steer / follow-up starts new work before the tail expires.
    state = observe(state, observation(TURN_2, false), 2_000);
    expect(state.active).toBeNull();
  });

  it("disarms on a thread switch and does not re-arm for the new thread's settled turn", () => {
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);
    state = observe(state, observation(TURN_1, true, "completed"), 1_000);
    expect(state.active).toBe("completed");

    state = observe(state, observation(TURN_B, true, "completed"), 2_000);
    expect(state.active).toBeNull();
    // Watching thread B's settled turn longer keeps it folded.
    state = observe(state, observation(TURN_B, true, "completed"), 5_000);
    expect(state.active).toBeNull();
  });

  it("disarms when switching environments with matching thread and turn IDs", () => {
    const environmentA = "environment-a:shared-thread:shared-turn";
    const environmentB = "environment-b:shared-thread:shared-turn";
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(environmentA, false), 0);
    state = observe(state, observation(environmentA, true, "completed"), 1_000);
    expect(state.active).toBe("completed");

    state = observe(state, observation(environmentB, true, "completed"), 2_000);
    expect(state.active).toBeNull();
  });

  it("re-arms for the next turn's settle with a fresh deadline", () => {
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);
    state = observe(state, observation(TURN_1, true, "completed"), 1_000);

    state = observe(state, observation(TURN_2, false), 2_000);
    expect(state.active).toBeNull();
    state = observe(state, observation(TURN_2, false, null), 2_500);
    expect(state.active).toBeNull();

    state = observe(state, observation(TURN_2, true, "error"), 3_000);
    expect(state.active).toBe("error");
    expect(state.expiresAt).toBe(3_000 + WORKING_ROW_SETTLED_TAIL_MS);
  });

  it("does not re-arm from repeated settled observations after expiry", () => {
    let state = observe(EMPTY_SETTLED_TAIL_STATE, observation(TURN_1, false), 0);
    state = observe(state, observation(TURN_1, true, "completed"), 1_000);
    state = observe(
      state,
      observation(TURN_1, true, "completed"),
      1_000 + WORKING_ROW_SETTLED_TAIL_MS,
    );
    expect(state.active).toBeNull();

    // The settled turn keeps emitting the same state after expiry.
    const repeated = observe(state, observation(TURN_1, true, "completed"), 10_000);
    expect(repeated.active).toBeNull();
    expect(repeated).toBe(state);
  });
});
