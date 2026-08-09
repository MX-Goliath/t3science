import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderRateLimitsMeter, providerRateLimitColor } from "./ProviderRateLimitsMeter";

describe("ProviderRateLimitsMeter", () => {
  it("uses green, orange, and red tracks at the requested thresholds", () => {
    expect(providerRateLimitColor(51)).toBe("var(--color-success)");
    expect(providerRateLimitColor(50)).toBe("var(--color-warning)");
    expect(providerRateLimitColor(20)).toBe("var(--color-warning)");
    expect(providerRateLimitColor(19)).toBe("var(--color-error)");
  });

  it("renders visible percentages for both available windows", () => {
    const markup = renderToStaticMarkup(
      <ProviderRateLimitsMeter
        providerLabel="Codex"
        rateLimits={{
          fiveHour: { remainingPercent: 68 },
          weekly: { remainingPercent: 19 },
        }}
      />,
    );

    expect(markup).toContain("5h");
    expect(markup).toContain("68%");
    expect(markup).toContain("Week");
    expect(markup).toContain("19%");
    expect(markup).toContain("var(--color-success)");
    expect(markup).toContain("var(--color-error)");
  });

  it("labels the meters with the active provider", () => {
    const markup = renderToStaticMarkup(
      <ProviderRateLimitsMeter
        providerLabel="Claude"
        rateLimits={{ fiveHour: { remainingPercent: 84 } }}
      />,
    );

    expect(markup).toContain("Claude usage limits");
    expect(markup).toContain("5-hour Claude limit: 84% remaining");
  });

  it("renders only the weekly window when the provider omits the 5-hour limit", () => {
    const markup = renderToStaticMarkup(
      <ProviderRateLimitsMeter
        providerLabel="Codex"
        rateLimits={{ weekly: { remainingPercent: 76 } }}
      />,
    );

    expect(markup).not.toContain("5h");
    expect(markup).toContain("Week");
    expect(markup).toContain("76%");
  });
});
