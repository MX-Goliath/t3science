import type { ServerProviderRateLimits } from "@t3tools/contracts";

export type ScheduledSendSource = "custom" | "rate-limit";
export type ScheduledSendLimitWindow = "fiveHour" | "weekly";

export interface ScheduledSendState {
  scheduledAt: string;
  source: ScheduledSendSource;
  limitWindow?: ScheduledSendLimitWindow;
}

export interface RateLimitSchedule {
  scheduledSend: ScheduledSendState;
  remainingPercent: number;
  limitWindow: ScheduledSendLimitWindow;
}

const LOW_LIMIT_THRESHOLD_PERCENT = 20;

export function resolveRateLimitSchedule(
  rateLimits: ServerProviderRateLimits | null | undefined,
  nowMs = Date.now(),
): RateLimitSchedule | null {
  const limitWindow: ScheduledSendLimitWindow | null = rateLimits?.fiveHour
    ? "fiveHour"
    : rateLimits?.weekly
      ? "weekly"
      : null;
  if (!limitWindow) return null;

  const window = rateLimits?.[limitWindow];
  if (
    !window ||
    window.remainingPercent >= LOW_LIMIT_THRESHOLD_PERCENT ||
    window.resetsAt === undefined
  ) {
    return null;
  }

  const scheduledAtMs = window.resetsAt * 1_000;
  if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= nowMs) return null;

  return {
    scheduledSend: {
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      source: "rate-limit",
      limitWindow,
    },
    remainingPercent: window.remainingPercent,
    limitWindow,
  };
}

export function scheduledSendTimeMs(scheduledSend: ScheduledSendState): number | null {
  const value = Date.parse(scheduledSend.scheduledAt);
  return Number.isFinite(value) ? value : null;
}

export function isScheduledSendOverdue(
  scheduledSend: ScheduledSendState | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!scheduledSend) return false;
  const scheduledAtMs = scheduledSendTimeMs(scheduledSend);
  return scheduledAtMs === null || scheduledAtMs <= nowMs;
}

interface ArmedScheduledSend {
  scheduledAtMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

const armedScheduledSends = new Map<string, ArmedScheduledSend>();
const MAX_TIMEOUT_MS = 2_147_483_647;

export function cancelArmedScheduledSend(key: string): void {
  const armed = armedScheduledSends.get(key);
  if (!armed) return;
  globalThis.clearTimeout(armed.timeoutId);
  armedScheduledSends.delete(key);
}

export function armScheduledSend(input: {
  key: string;
  scheduledSend: ScheduledSendState;
  onDue: () => void | Promise<void>;
}): boolean {
  const scheduledAtMs = scheduledSendTimeMs(input.scheduledSend);
  if (scheduledAtMs === null || scheduledAtMs <= Date.now()) return false;

  cancelArmedScheduledSend(input.key);
  const armNextBoundary = () => {
    const remainingMs = scheduledAtMs - Date.now();
    const timeoutId = globalThis.setTimeout(
      () => {
        if (Date.now() < scheduledAtMs) {
          armNextBoundary();
          return;
        }
        armedScheduledSends.delete(input.key);
        void input.onDue();
      },
      Math.min(remainingMs, MAX_TIMEOUT_MS),
    );
    armedScheduledSends.set(input.key, { scheduledAtMs, timeoutId });
  };
  armNextBoundary();
  return true;
}

export function isScheduledSendArmed(key: string, scheduledAt: string): boolean {
  const scheduledAtMs = Date.parse(scheduledAt);
  return armedScheduledSends.get(key)?.scheduledAtMs === scheduledAtMs;
}

export function resetScheduledSendRuntimeForTests(): void {
  for (const armed of armedScheduledSends.values()) {
    globalThis.clearTimeout(armed.timeoutId);
  }
  armedScheduledSends.clear();
}
