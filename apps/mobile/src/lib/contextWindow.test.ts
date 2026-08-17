import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot, formatCompactTokens } from "./contextWindow";

describe("mobile context window", () => {
  it("uses the latest valid provider snapshot", () => {
    const activity = (id: string, usedTokens: number): OrchestrationThreadActivity => ({
      id: EventId.make(id),
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: { usedTokens, maxTokens: 200_000 },
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-08-16T12:00:00.000Z",
    });
    const activities = [activity("context-1", 10_000), activity("context-2", 60_000)];

    expect(deriveLatestContextWindowSnapshot(activities)).toEqual({
      usedTokens: 60_000,
      maxTokens: 200_000,
      usedPercentage: 30,
    });
    expect(formatCompactTokens(60_000)).toBe("60k");
  });
});
