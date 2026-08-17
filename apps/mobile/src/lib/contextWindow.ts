import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

export interface MobileContextWindowSnapshot {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly usedPercentage: number | null;
}

function finiteNonNegative(value: unknown): number | null {
  return Predicate.isNumber(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): MobileContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "context-window.updated" || !Predicate.isObject(activity.payload)) {
      continue;
    }
    const usedTokens = finiteNonNegative(activity.payload.usedTokens);
    if (usedTokens === null) {
      continue;
    }
    const rawMaxTokens = finiteNonNegative(activity.payload.maxTokens);
    const maxTokens = rawMaxTokens !== null && rawMaxTokens > 0 ? rawMaxTokens : null;
    return {
      usedTokens,
      maxTokens,
      usedPercentage:
        maxTokens === null ? null : Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
    };
  }
  return null;
}

export function formatCompactTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
