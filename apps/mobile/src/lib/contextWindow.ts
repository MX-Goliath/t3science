import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
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
  projection: OrchestrationV2ThreadProjection,
): MobileContextWindowSnapshot | null {
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  const usage = providerThread?.contextUsage;
  if (!usage) return null;
  const usedTokens = finiteNonNegative(usage.usedTokens);
  if (usedTokens === null) return null;
  const rawMaxTokens = finiteNonNegative(usage.maxTokens);
  const maxTokens = rawMaxTokens !== null && rawMaxTokens > 0 ? rawMaxTokens : null;
  return {
    usedTokens,
    maxTokens,
    usedPercentage:
      maxTokens === null ? null : Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
  };
}

export function formatCompactTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
