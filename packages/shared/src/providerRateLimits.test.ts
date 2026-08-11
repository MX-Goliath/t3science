import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_RATE_LIMIT_REFRESH_INTERVAL_MS } from "./providerRateLimits.js";

describe("provider rate limit refresh interval", () => {
  it("is five minutes", () => {
    expect(PROVIDER_RATE_LIMIT_REFRESH_INTERVAL_MS).toBe(300_000);
  });
});
