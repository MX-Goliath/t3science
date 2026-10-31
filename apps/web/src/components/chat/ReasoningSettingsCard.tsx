import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { ChevronRightIcon, RotateCcwIcon, ZapIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import styles from "./ReasoningSettingsCard.module.css";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export interface ModelResetAction {
  readonly label: string;
  readonly disabledReason: string | null;
  readonly onReset: () => void;
}

export function ReasoningSettingsCard(props: {
  effort: SelectDescriptor;
  value: string | null;
  speed: ProviderOptionDescriptor | null;
  speedValue: string | boolean | undefined;
  modelLabel: string;
  effortDisabled: boolean;
  onEffortChange: (value: string) => void;
  onSpeedChange: (value: string | boolean) => void;
  onReset: () => void;
  modelReset?: ModelResetAction;
  onOpenModelPicker?: (() => void) | undefined;
}) {
  const choices = props.effort.options;
  const selectedIndex = choices.findIndex((option) => option.id === props.value);
  const index = Math.max(
    0,
    selectedIndex < 0 ? choices.findIndex((option) => option.isDefault) : selectedIndex,
  );
  const progress = choices.length > 1 ? index / (choices.length - 1) : 0;
  const label = selectedIndex < 0 ? (props.value ?? "Default") : choices[index]!.label;
  const ultra = props.value === "ultra";
  const speedChoices =
    props.speed?.type === "select"
      ? props.speed.options.map((option) => ({ value: option.id, label: option.label }))
      : props.speed
        ? [
            { value: false, label: "Normal" },
            { value: true, label: "Fast" },
          ]
        : [];
  const speedIndex = speedChoices.findIndex((option) => option.value === props.speedValue);
  const currentSpeed = speedChoices[speedIndex];
  const nextSpeed = speedChoices[(speedIndex + 1) % speedChoices.length];
  const accelerated =
    currentSpeed?.value === true ||
    currentSpeed?.label === "Fast" ||
    currentSpeed?.label === "Ultrafast";

  return (
    <div className={cn(styles.card, "w-70 max-w-full px-2 py-2")} data-effort-ultra={ultra}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-1">
        {props.speed && nextSpeed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={styles.icon}
                  data-speed-active={accelerated}
                  aria-pressed={accelerated}
                  aria-label={`Speed: ${currentSpeed?.label ?? "Default"}. Switch to ${nextSpeed.label}`}
                  onClick={() => props.onSpeedChange(nextSpeed.value)}
                />
              }
            >
              <ZapIcon
                key={String(props.speedValue)}
                className={cn(
                  styles.label,
                  "size-3.5",
                  accelerated && "fill-current",
                  currentSpeed?.label === "Ultrafast" && "drop-shadow-sm",
                )}
              />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Speed: {currentSpeed?.label ?? "Default"} · Switch to {nextSpeed.label}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span />
        )}
        <div className="grid min-w-0 justify-items-center gap-0.5 pb-3 pt-0.5">
          <span
            key={label}
            className={cn(
              styles.label,
              styles.effort,
              "max-w-full truncate text-base font-medium leading-5",
            )}
            aria-live="polite"
          >
            {label}
          </span>
          {props.onOpenModelPicker ? (
            <button
              type="button"
              onClick={props.onOpenModelPicker}
              aria-label={`Change model: ${props.modelLabel}`}
              className="group/model flex max-w-full items-center rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate">{props.modelLabel}</span>
              <ChevronRightIcon className="size-3 shrink-0 transition-transform duration-150 group-hover/model:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          ) : (
            <span className="max-w-full truncate text-xs text-muted-foreground">
              {props.modelLabel}
            </span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(styles.icon, "group/reset")}
                aria-label={props.modelReset?.label ?? "Reset effort and speed"}
                disabled={props.effortDisabled || Boolean(props.modelReset?.disabledReason)}
                onClick={props.onReset}
              />
            }
          >
            <RotateCcwIcon className="size-3.5 transition-transform duration-200 group-active/reset:-rotate-90 motion-reduce:transition-none" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {props.modelReset?.disabledReason ??
              props.modelReset?.label ??
              "Reset effort and speed"}
          </TooltipPopup>
        </Tooltip>
      </div>
      <div
        className={cn(
          styles.slider,
          "relative h-6 rounded-full bg-foreground/10",
          props.effortDisabled && "opacity-50",
        )}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <div
            className={cn(styles.fill, "h-full")}
            style={{ width: `calc(${progress * 100}% + ${12 - 24 * progress}px)` }}
          />
          {ultra ? <span aria-hidden className={styles.sparkles} /> : null}
        </div>
        <div
          className={cn(
            styles.ticks,
            "pointer-events-none absolute inset-y-0 inset-x-3 flex items-center justify-between",
          )}
        >
          {choices.map((option, tick) => (
            <span
              key={option.id}
              className={cn(
                "size-1 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                tick <= index ? "bg-white/45" : "bg-foreground/25",
              )}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 inset-x-3">
          <span
            className={cn(
              styles.thumb,
              "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm",
            )}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <input
          type="range"
          className={cn(
            styles.range,
            "absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed",
          )}
          aria-label={props.effort.label}
          aria-valuetext={label}
          min={0}
          max={Math.max(0, choices.length - 1)}
          step={1}
          value={index}
          disabled={props.effortDisabled || choices.length < 2}
          onKeyDown={(event) => {
            // Let the range handle its arrow keys instead of the surrounding menu.
            if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
          }}
          onChange={(event) => {
            const option = choices[Number(event.currentTarget.value)];
            if (option) props.onEffortChange(option.id);
          }}
        />
      </div>
      {props.effortDisabled ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Remove “ultrathink” from your message to change reasoning effort.
        </p>
      ) : null}
    </div>
  );
}
