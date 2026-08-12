import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  armAgentCompletionSend,
  armScheduledSend,
  isScheduledSendArmed,
  isScheduledSendOverdue,
  resetScheduledSendRuntimeForTests,
  resolveAgentCompletionScheduleTarget,
  resolveRunningAgentScheduleTargets,
  resolveRateLimitSchedule,
  shouldPlaceScheduledSendInSidebarSection,
} from "./scheduledSend";

afterEach(() => {
  resetScheduledSendRuntimeForTests();
  vi.useRealTimers();
});

describe("resolveRateLimitSchedule", () => {
  const nowMs = Date.parse("2026-08-09T12:00:00.000Z");

  it("uses the low 5-hour window and its fixed reset time", () => {
    expect(
      resolveRateLimitSchedule(
        {
          fiveHour: { remainingPercent: 19, resetsAt: nowMs / 1_000 + 300 },
          weekly: { remainingPercent: 1, resetsAt: nowMs / 1_000 + 600 },
        },
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
        { weekly: { remainingPercent: 8, resetsAt: nowMs / 1_000 + 600 } },
        nowMs,
      )?.limitWindow,
    ).toBe("weekly");
    expect(
      resolveRateLimitSchedule(
        {
          fiveHour: { remainingPercent: 80, resetsAt: nowMs / 1_000 + 300 },
          weekly: { remainingPercent: 8, resetsAt: nowMs / 1_000 + 600 },
        },
        nowMs,
      ),
    ).toBeNull();
  });

  it("is unavailable at 20 percent, without a reset, or after the reset", () => {
    expect(
      resolveRateLimitSchedule(
        { fiveHour: { remainingPercent: 20, resetsAt: nowMs / 1_000 + 60 } },
        nowMs,
      ),
    ).toBeNull();
    expect(resolveRateLimitSchedule({ fiveHour: { remainingPercent: 1 } }, nowMs)).toBeNull();
    expect(
      resolveRateLimitSchedule(
        { fiveHour: { remainingPercent: 1, resetsAt: nowMs / 1_000 } },
        nowMs,
      ),
    ).toBeNull();
  });
});

describe("scheduled send runtime", () => {
  it("keeps agent-completion sends in the active sidebar section", () => {
    expect(
      shouldPlaceScheduledSendInSidebarSection({
        scheduledAt: "2026-08-09T12:00:00.000Z",
        source: "agent-completion",
      }),
    ).toBe(false);
    expect(
      shouldPlaceScheduledSendInSidebarSection({
        scheduledAt: "2026-08-09T12:00:00.000Z",
        source: "custom",
      }),
    ).toBe(true);
    expect(shouldPlaceScheduledSendInSidebarSection(null)).toBe(false);
  });

  it("resolves the active turn as an agent-completion target", () => {
    expect(
      resolveAgentCompletionScheduleTarget({
        environmentId: "env-1" as never,
        id: "current" as never,
        title: "Current",
        session: { status: "running", activeTurnId: "turn-current" as never },
      } as never),
    ).toEqual({
      environmentId: "env-1",
      threadId: "current",
      turnId: "turn-current",
      threadTitle: "Current",
    });
  });

  it("does not resolve an agent-completion target without a running turn", () => {
    expect(
      resolveAgentCompletionScheduleTarget({
        environmentId: "env-1" as never,
        id: "idle" as never,
        title: "Idle",
        session: { status: "idle", activeTurnId: null },
      } as never),
    ).toBeNull();
  });

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

  it("sends when the selected agent turn completes", () => {
    let state: "running" | "complete" = "running";
    let notify = () => {};
    const unsubscribe = vi.fn();
    const onDue = vi.fn();

    expect(
      armAgentCompletionSend({
        key: "thread",
        getWaitingState: () => state,
        subscribe: (onChange) => {
          notify = onChange;
          return unsubscribe;
        },
        onDue,
      }),
    ).toBe(true);
    expect(onDue).not.toHaveBeenCalled();

    state = "complete";
    notify();
    notify();
    expect(onDue).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("offers only running turns from other chats", () => {
    const environmentId = "env-1" as never;
    const targets = resolveRunningAgentScheduleTargets(
      [
        {
          environmentId,
          id: "current" as never,
          title: "Current",
          session: { status: "running", activeTurnId: "turn-current" as never },
        },
        {
          environmentId,
          id: "running" as never,
          title: "Running elsewhere",
          session: { status: "running", activeTurnId: "turn-running" as never },
        },
        {
          environmentId,
          id: "idle" as never,
          title: "Idle",
          session: { status: "idle", activeTurnId: null },
        },
      ] as never,
      { environmentId, threadId: "current" as never },
    );

    expect(targets).toEqual([
      {
        environmentId,
        threadId: "running",
        turnId: "turn-running",
        threadTitle: "Running elsewhere",
      },
    ]);
  });
});
