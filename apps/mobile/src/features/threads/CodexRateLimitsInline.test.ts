import { describe, expect, it } from "vite-plus/test";

import { codexRateLimitTrackColor, didMobileCodexResponseFinish } from "./codexRateLimits";

describe("mobile Codex rate limits", () => {
  it("uses green, orange, and red tracks at the requested thresholds", () => {
    expect(codexRateLimitTrackColor(51)).toBe("#22c55e");
    expect(codexRateLimitTrackColor(50)).toBe("#f59e0b");
    expect(codexRateLimitTrackColor(20)).toBe("#f59e0b");
    expect(codexRateLimitTrackColor(19)).toBe("#ef4444");
  });

  it("refreshes after a running response settles", () => {
    expect(didMobileCodexResponseFinish("running", "ready")).toBe(true);
    expect(didMobileCodexResponseFinish("ready", "running")).toBe(false);
  });
});
