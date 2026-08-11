import type { EnvironmentId, ServerProviderRateLimits, ThreadId, TurnId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export type ScheduledSendSource = "custom" | "rate-limit" | "agent-completion";
export type ScheduledSendLimitWindow = "fiveHour" | "weekly";

export interface ScheduledSendAgentTarget {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId: TurnId;
  threadTitle: string;
}

export interface ScheduledSendState {
  scheduledAt: string;
  source: ScheduledSendSource;
  limitWindow?: ScheduledSendLimitWindow;
  waitingForAgent?: ScheduledSendAgentTarget;
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
  if (scheduledSend.source === "agent-completion") return false;
  const scheduledAtMs = scheduledSendTimeMs(scheduledSend);
  return scheduledAtMs === null || scheduledAtMs <= nowMs;
}

export function resolveRunningAgentScheduleTargets(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  currentThread: { environmentId: EnvironmentId; threadId: ThreadId },
): ScheduledSendAgentTarget[] {
  return shells.flatMap((shell) => {
    const activeTurnId = shell.session?.status === "running" ? shell.session.activeTurnId : null;
    if (
      activeTurnId === null ||
      (shell.environmentId === currentThread.environmentId && shell.id === currentThread.threadId)
    ) {
      return [];
    }
    return [
      {
        environmentId: shell.environmentId,
        threadId: shell.id,
        turnId: activeTurnId,
        threadTitle: shell.title,
      },
    ];
  });
}

interface ArmedScheduledSend {
  scheduledAtMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface ArmedAgentCompletionSend {
  unsubscribe: (() => void) | null;
}

const armedScheduledSends = new Map<string, ArmedScheduledSend>();
const armedAgentCompletionSends = new Map<string, ArmedAgentCompletionSend>();
const MAX_TIMEOUT_MS = 2_147_483_647;

export function cancelArmedScheduledSend(key: string): void {
  const armed = armedScheduledSends.get(key);
  if (armed) {
    globalThis.clearTimeout(armed.timeoutId);
    armedScheduledSends.delete(key);
  }
  const agentCompletion = armedAgentCompletionSends.get(key);
  agentCompletion?.unsubscribe?.();
  armedAgentCompletionSends.delete(key);
}

export function armAgentCompletionSend(input: {
  key: string;
  getWaitingState: () => "running" | "complete" | "unknown";
  subscribe: (onChange: () => void) => () => void;
  onDue: () => void | Promise<void>;
}): boolean {
  cancelArmedScheduledSend(input.key);
  const armed: ArmedAgentCompletionSend = { unsubscribe: null };
  armedAgentCompletionSends.set(input.key, armed);

  const check = () => {
    if (armedAgentCompletionSends.get(input.key) !== armed) return;
    if (input.getWaitingState() !== "complete") return;
    armed.unsubscribe?.();
    armedAgentCompletionSends.delete(input.key);
    void input.onDue();
  };

  const unsubscribe = input.subscribe(check);
  armed.unsubscribe = unsubscribe;
  if (!armedAgentCompletionSends.has(input.key)) {
    unsubscribe();
    return true;
  }
  check();
  return true;
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
  for (const armed of armedAgentCompletionSends.values()) {
    armed.unsubscribe?.();
  }
  armedAgentCompletionSends.clear();
}
