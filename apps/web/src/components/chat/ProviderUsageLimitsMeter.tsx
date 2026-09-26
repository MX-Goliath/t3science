import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProviderResetCredits,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { ResetCreditDialog, resetCreditsSummary, useResetCredit } from "../usage/UsageLimits";

export function providerUsageLimitColor(remainingPercent: number): string {
  if (remainingPercent > 50) return "var(--color-success)";
  if (remainingPercent >= 20) return "var(--color-warning)";
  return "var(--color-error)";
}

export function canResetLowWeeklyLimit(
  window: ServerProviderUsageWindow,
  credits: ServerProviderResetCredits | undefined,
): boolean {
  return window.kind === "weekly" && window.usedPercent > 90 && (credits?.availableCount ?? 0) > 0;
}

function UsageWindow(props: {
  window: ServerProviderUsageWindow;
  providerLabel: string;
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
  credits: ServerProviderResetCredits | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const redeem = useResetCredit(props.environmentId, { instanceId: props.instanceId });
  const showReset = canResetLowWeeklyLimit(props.window, props.credits);
  useEffect(() => {
    if (redeem.status) toastManager.add({ type: "info", title: redeem.status });
  }, [redeem.status]);
  const remaining = remainingPercent(props.window);
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const resetTime = props.window.resetsAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(props.window.resetsAt),
      )
    : null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setNow(Date.now());
      }}
    >
      <PopoverTrigger
        openOnHover
        render={
          <button
            type="button"
            className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-2xs text-muted-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
            stroke="currentColor"
            className="text-muted-foreground/20"
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
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        padding="compact"
        width={showReset ? "md" : "auto"}
        tooltipStyle={!showReset}
      >
        <div className="flex flex-col gap-0.5 text-xs">
          <span>{remaining}% remaining</span>
          {resetTime ? <span className="text-secondary-label">Resets {resetTime}</span> : null}
          {showReset && props.credits ? (
            <div className="mt-2 flex flex-col items-start gap-2 border-t border-border/60 pt-2">
              <span className="text-muted-foreground tabular-nums">
                {resetCreditsSummary(props.credits, now)}
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={redeem.busy}
                onClick={() => {
                  setOpen(false);
                  redeem.setConfirming(true);
                }}
              >
                {redeem.busy ? "Using…" : "Use reset"}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        onConfirm={() => void redeem.redeem()}
      />
    </Popover>
  );
}

export function ProviderUsageLimitsMeter(props: {
  limits: ServerProviderUsageLimits;
  providerLabel: string;
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
}) {
  if (props.limits.unavailable || props.limits.windows.length === 0) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      aria-label={`${props.providerLabel} limits`}
    >
      {props.limits.windows.slice(0, 2).map((window) => (
        <UsageWindow
          key={JSON.stringify([props.environmentId, props.instanceId, window.id])}
          window={window}
          providerLabel={props.providerLabel}
          environmentId={props.environmentId}
          instanceId={props.instanceId}
          credits={props.limits.resetCredits}
        />
      ))}
    </div>
  );
}
