import type { ServerProviderRateLimitWindow, ServerProviderRateLimits } from "@t3tools/contracts";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function providerRateLimitColor(remainingPercent: number): string {
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

function ProviderRateLimit(props: {
  label: string;
  accessibleLabel: string;
  window: ServerProviderRateLimitWindow;
}) {
  const remainingPercent = Math.max(0, Math.min(100, props.window.remainingPercent));
  const color = providerRateLimitColor(remainingPercent);
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
        <span className="flex flex-col gap-0.5">
          <span>
            {props.accessibleLabel}: {remainingPercent}% remaining
          </span>
          {resetTime ? <span className="text-secondary-label">Resets {resetTime}</span> : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

// Text-only limit item (no ring): the value stays hidden until hover,
// used for longer windows like the monthly Go quota.
function ProviderRateLimitText(props: {
  label: string;
  accessibleLabel: string;
  window: ServerProviderRateLimitWindow;
}) {
  const remainingPercent = Math.max(0, Math.min(100, props.window.remainingPercent));
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
        <span>{props.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex flex-col gap-0.5">
          <span>
            {props.accessibleLabel}: {remainingPercent}% remaining
          </span>
          {resetTime ? <span className="text-secondary-label">Resets {resetTime}</span> : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

export function ProviderRateLimitsMeter(props: {
  rateLimits: ServerProviderRateLimits;
  providerLabel: string;
}) {
  const { fiveHour, weekly, monthly } = props.rateLimits;
  if (!fiveHour && !weekly && !monthly) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      aria-label={`${props.providerLabel} usage limits`}
    >
      {fiveHour ? (
        <ProviderRateLimit
          label="5h"
          accessibleLabel={`5-hour ${props.providerLabel} limit`}
          window={fiveHour}
        />
      ) : null}
      {weekly ? (
        <ProviderRateLimit
          label="Week"
          accessibleLabel={`Weekly ${props.providerLabel} limit`}
          window={weekly}
        />
      ) : null}
      {monthly ? (
        <ProviderRateLimitText
          label="Monthly"
          accessibleLabel={`Monthly ${props.providerLabel} limit`}
          window={monthly}
        />
      ) : null}
    </div>
  );
}
