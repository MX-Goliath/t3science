import { describe, expect, it } from "vite-plus/test";

import { didProviderResponseFinish } from "./useProviderRateLimits";

describe("didProviderResponseFinish", () => {
  it("refreshes after a running response settles", () => {
    expect(didProviderResponseFinish("running", "ready")).toBe(true);
    expect(didProviderResponseFinish("running", "disconnected")).toBe(true);
  });

  it("does not refresh for unrelated phase changes", () => {
    expect(didProviderResponseFinish("ready", "running")).toBe(false);
    expect(didProviderResponseFinish("ready", "ready")).toBe(false);
  });
});
