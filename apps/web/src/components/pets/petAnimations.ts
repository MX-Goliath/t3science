import type { DesktopPetAnimationState } from "@t3tools/contracts";

export interface PetAnimationDefinition {
  readonly row: number;
  readonly frames: number;
  readonly durationMs: number;
}

export const PET_ANIMATIONS: Readonly<Record<DesktopPetAnimationState, PetAnimationDefinition>> = {
  idle: { row: 0, frames: 6, durationMs: 5_500 },
  "running-right": { row: 1, frames: 8, durationMs: 1_060 },
  "running-left": { row: 2, frames: 8, durationMs: 1_060 },
  waving: { row: 3, frames: 4, durationMs: 700 },
  jumping: { row: 4, frames: 5, durationMs: 840 },
  failed: { row: 5, frames: 8, durationMs: 1_220 },
  waiting: { row: 6, frames: 6, durationMs: 1_010 },
  running: { row: 7, frames: 6, durationMs: 820 },
  review: { row: 8, frames: 6, durationMs: 1_030 },
};

export const PET_ANIMATION_OPTIONS = [
  { id: "idle", label: "Idle" },
  { id: "running-right", label: "Running right" },
  { id: "running-left", label: "Running left" },
  { id: "waving", label: "Waving" },
  { id: "jumping", label: "Jumping" },
  { id: "failed", label: "Failed" },
  { id: "waiting", label: "Waiting" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
] as const satisfies ReadonlyArray<{ id: DesktopPetAnimationState; label: string }>;
