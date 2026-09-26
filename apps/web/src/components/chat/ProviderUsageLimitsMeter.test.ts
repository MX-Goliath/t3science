import { describe, expect, it } from "vite-plus/test";

import { canResetLowWeeklyLimit, providerUsageLimitColor } from "./ProviderUsageLimitsMeter";

describe("providerUsageLimitColor", () => {
  it("changes at the warning and error thresholds", () => {
    expect(providerUsageLimitColor(51)).toBe("var(--color-success)");
    expect(providerUsageLimitColor(50)).toBe("var(--color-warning)");
    expect(providerUsageLimitColor(20)).toBe("var(--color-warning)");
    expect(providerUsageLimitColor(19)).toBe("var(--color-error)");
  });
});

describe("canResetLowWeeklyLimit", () => {
  it.each([
    ["weekly", 91, 2, true],
    ["weekly", 90.1, 2, true],
    ["weekly", 90, 2, false],
    ["weekly", 89, 2, false],
    ["weekly", 100, 0, false],
    ["session", 99, 2, false],
    ["monthly", 99, 2, false],
    ["other", 99, 2, false],
  ] as const)(
    "%s window at %s%% used with %s credits",
    (kind, usedPercent, availableCount, expected) => {
      expect(
        canResetLowWeeklyLimit({ id: kind, kind, label: kind, usedPercent }, { availableCount }),
      ).toBe(expected);
    },
  );
  it("does not offer a reset for providers without credits", () => {
    expect(
      canResetLowWeeklyLimit(
        { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 99 },
        undefined,
      ),
    ).toBe(false);
  });
});
