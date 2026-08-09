export function providerRateLimitTrackColor(remainingPercent: number): string {
  if (remainingPercent > 50) return "#22c55e";
  if (remainingPercent >= 20) return "#f59e0b";
  return "#ef4444";
}

export function didMobileProviderResponseFinish(
  previousStatus: string | null,
  currentStatus: string | null,
): boolean {
  return previousStatus === "running" && currentStatus !== "running";
}
