import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CodexRateLimitsMeter, codexRateLimitColor } from "./CodexRateLimitsMeter";

describe("CodexRateLimitsMeter", () => {
  it("uses green, orange, and red tracks at the requested thresholds", () => {
    expect(codexRateLimitColor(51)).toBe("var(--color-success)");
    expect(codexRateLimitColor(50)).toBe("var(--color-warning)");
    expect(codexRateLimitColor(20)).toBe("var(--color-warning)");
    expect(codexRateLimitColor(19)).toBe("var(--color-error)");
  });

  it("renders visible percentages for both available windows", () => {
    const markup = renderToStaticMarkup(
      <CodexRateLimitsMeter
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

  it("renders only the weekly window when Codex omits the 5-hour limit", () => {
    const markup = renderToStaticMarkup(
      <CodexRateLimitsMeter rateLimits={{ weekly: { remainingPercent: 76 } }} />,
    );

    expect(markup).not.toContain("5h");
    expect(markup).toContain("Week");
    expect(markup).toContain("76%");
  });
});
