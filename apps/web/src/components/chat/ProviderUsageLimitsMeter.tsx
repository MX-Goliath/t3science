import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function providerUsageLimitColor(remainingPercent: number): string {
  if (remainingPercent > 50) return "var(--color-success)";
  if (remainingPercent >= 20) return "var(--color-warning)";
  return "var(--color-error)";
}

function UsageWindow(props: { window: ServerProviderUsageWindow; providerLabel: string }) {
  const remaining = remainingPercent(props.window);
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const resetTime = props.window.resetsAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(props.window.resetsAt),
      )
    : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            aria-label={`${props.window.label} ${props.providerLabel} limit: ${remaining}% remaining`}
          />
        }
      >
        <svg viewBox="0 0 20 20" className="size-4 shrink-0 -rotate-90" aria-hidden="true">
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
            stroke={providerUsageLimitColor(remaining)}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - remaining / 100)}
          />
        </svg>
        <span>{props.window.label}</span>
        <span className="font-medium text-foreground">{remaining}%</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex flex-col gap-0.5">
          <span>{remaining}% remaining</span>
          {resetTime ? <span className="text-secondary-label">Resets {resetTime}</span> : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

export function ProviderUsageLimitsMeter(props: {
  limits: ServerProviderUsageLimits;
  providerLabel: string;
}) {
  if (props.limits.unavailable || props.limits.windows.length === 0) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      aria-label={`${props.providerLabel} limits`}
    >
      {props.limits.windows.slice(0, 2).map((window) => (
        <UsageWindow key={window.id} window={window} providerLabel={props.providerLabel} />
      ))}
    </div>
  );
}
