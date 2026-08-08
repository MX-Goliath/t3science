import type { ServerProviderRateLimitWindow, ServerProviderRateLimits } from "@t3tools/contracts";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function codexRateLimitColor(remainingPercent: number): string {
  if (remainingPercent > 50) return "var(--color-success)";
  if (remainingPercent >= 20) return "var(--color-warning)";
  return "var(--color-error)";
}

function formatResetTime(resetsAt: number | undefined): string | null {
  if (resetsAt === undefined) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(resetsAt * 1_000));
}

function CodexRateLimit(props: {
  label: string;
  accessibleLabel: string;
  window: ServerProviderRateLimitWindow;
}) {
  const remainingPercent = Math.max(0, Math.min(100, props.window.remainingPercent));
  const color = codexRateLimitColor(remainingPercent);
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - remainingPercent / 100);
  const resetTime = formatResetTime(props.window.resetsAt);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            aria-label={`${props.accessibleLabel}: ${remainingPercent}% remaining`}
          />
        }
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4 shrink-0 -rotate-90 transform-gpu"
          aria-hidden="true"
        >
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="color-mix(in oklab, var(--color-muted-foreground) 22%, transparent)"
            strokeWidth="2.5"
          />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>
        <span>{props.label}</span>
        <span className="font-medium text-foreground">{remainingPercent}%</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {props.accessibleLabel}: {remainingPercent}% remaining
        {resetTime ? ` · Resets ${resetTime}` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

export function CodexRateLimitsMeter(props: { rateLimits: ServerProviderRateLimits }) {
  if (!props.rateLimits.fiveHour && !props.rateLimits.weekly) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5" aria-label="Codex usage limits">
      {props.rateLimits.fiveHour ? (
        <CodexRateLimit
          label="5h"
          accessibleLabel="5-hour Codex limit"
          window={props.rateLimits.fiveHour}
        />
      ) : null}
      {props.rateLimits.weekly ? (
        <CodexRateLimit
          label="Week"
          accessibleLabel="Weekly Codex limit"
          window={props.rateLimits.weekly}
        />
      ) : null}
    </div>
  );
}
