import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  armScheduledSend,
  isScheduledSendArmed,
  isScheduledSendOverdue,
  resetScheduledSendRuntimeForTests,
  resolveRateLimitSchedule,
} from "./scheduledSend";

afterEach(() => {
  resetScheduledSendRuntimeForTests();
  vi.useRealTimers();
});

describe("resolveRateLimitSchedule", () => {
  const nowMs = Date.parse("2026-08-09T12:00:00.000Z");
  const limits = (
    windows: Array<{
      id: string;
      kind: "session" | "weekly";
      label: string;
      usedPercent: number;
      resetsAt?: string;
    }>,
  ) => ({ checkedAt: new Date(nowMs).toISOString(), windows });

  it("uses the low 5-hour window and its fixed reset time", () => {
    expect(
      resolveRateLimitSchedule(
        limits([
          {
            id: "session",
            kind: "session",
            label: "Session",
            usedPercent: 81,
            resetsAt: new Date(nowMs + 300_000).toISOString(),
          },
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 99,
            resetsAt: new Date(nowMs + 600_000).toISOString(),
          },
        ]),
        nowMs,
      ),
    ).toMatchObject({
      limitWindow: "fiveHour",
      remainingPercent: 19,
      scheduledSend: {
        scheduledAt: "2026-08-09T12:05:00.000Z",
        source: "rate-limit",
        limitWindow: "fiveHour",
      },
    });
  });

  it("falls back to weekly only when the 5-hour window is absent", () => {
    expect(
      resolveRateLimitSchedule(
        limits([
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 92,
            resetsAt: new Date(nowMs + 600_000).toISOString(),
          },
        ]),
        nowMs,
      )?.limitWindow,
    ).toBe("weekly");
    expect(
      resolveRateLimitSchedule(
        limits([
          {
            id: "session",
            kind: "session",
            label: "Session",
            usedPercent: 20,
            resetsAt: new Date(nowMs + 300_000).toISOString(),
          },
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 92,
            resetsAt: new Date(nowMs + 600_000).toISOString(),
          },
        ]),
        nowMs,
      ),
    ).toBeNull();
  });

  it("is unavailable at 20 percent, without a reset, or after the reset", () => {
    expect(
      resolveRateLimitSchedule(
        limits([
          {
            id: "session",
            kind: "session",
            label: "Session",
            usedPercent: 80,
            resetsAt: new Date(nowMs + 60_000).toISOString(),
          },
        ]),
        nowMs,
      ),
    ).toBeNull();
    expect(
      resolveRateLimitSchedule(
        limits([{ id: "session", kind: "session", label: "Session", usedPercent: 99 }]),
        nowMs,
      ),
    ).toBeNull();
    expect(
      resolveRateLimitSchedule(
        limits([
          {
            id: "session",
            kind: "session",
            label: "Session",
            usedPercent: 99,
            resetsAt: new Date(nowMs).toISOString(),
          },
        ]),
        nowMs,
      ),
    ).toBeNull();
  });
});

describe("scheduled send runtime", () => {
  it("fires once at the computed time and can be recognized as armed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-09T12:00:00.000Z");
    const onDue = vi.fn();
    const scheduledSend = {
      scheduledAt: "2026-08-09T12:01:00.000Z",
      source: "custom" as const,
    };

    expect(armScheduledSend({ key: "thread", scheduledSend, onDue })).toBe(true);
    expect(isScheduledSendArmed("thread", scheduledSend.scheduledAt)).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(onDue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onDue).toHaveBeenCalledOnce();
    expect(isScheduledSendArmed("thread", scheduledSend.scheduledAt)).toBe(false);
  });

  it("does not arm an overdue send", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-09T12:00:00.000Z");
    const scheduledSend = {
      scheduledAt: "2026-08-09T11:59:59.000Z",
      source: "custom" as const,
    };
    expect(isScheduledSendOverdue(scheduledSend)).toBe(true);
    expect(armScheduledSend({ key: "thread", scheduledSend, onDue: vi.fn() })).toBe(false);
  });
});
