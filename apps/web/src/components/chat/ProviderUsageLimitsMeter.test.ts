import { describe, expect, it } from "vitest";

import { providerUsageLimitColor } from "./ProviderUsageLimitsMeter";

describe("providerUsageLimitColor", () => {
  it("changes at the warning and error thresholds", () => {
    expect(providerUsageLimitColor(51)).toBe("var(--color-success)");
    expect(providerUsageLimitColor(50)).toBe("var(--color-warning)");
    expect(providerUsageLimitColor(20)).toBe("var(--color-warning)");
    expect(providerUsageLimitColor(19)).toBe("var(--color-error)");
  });
});
