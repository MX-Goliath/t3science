import { describe, expect, it } from "vite-plus/test";

import { didCodexResponseFinish } from "./useCodexRateLimits";

describe("didCodexResponseFinish", () => {
  it("refreshes after a running response settles", () => {
    expect(didCodexResponseFinish("running", "ready")).toBe(true);
    expect(didCodexResponseFinish("running", "disconnected")).toBe(true);
  });

  it("does not refresh for unrelated phase changes", () => {
    expect(didCodexResponseFinish("ready", "running")).toBe(false);
    expect(didCodexResponseFinish("ready", "ready")).toBe(false);
  });
});
