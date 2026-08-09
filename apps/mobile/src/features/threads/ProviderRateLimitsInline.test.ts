import { describe, expect, it } from "vite-plus/test";

import { didMobileProviderResponseFinish, providerRateLimitTrackColor } from "./providerRateLimits";

describe("mobile provider rate limits", () => {
  it("uses green, orange, and red tracks at the requested thresholds", () => {
    expect(providerRateLimitTrackColor(51)).toBe("#22c55e");
    expect(providerRateLimitTrackColor(50)).toBe("#f59e0b");
    expect(providerRateLimitTrackColor(20)).toBe("#f59e0b");
    expect(providerRateLimitTrackColor(19)).toBe("#ef4444");
  });

  it("refreshes after a running response settles", () => {
    expect(didMobileProviderResponseFinish("running", "ready")).toBe(true);
    expect(didMobileProviderResponseFinish("ready", "running")).toBe(false);
  });
});
