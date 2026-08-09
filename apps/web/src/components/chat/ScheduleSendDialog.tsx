import { TimerIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

type SchedulePreset = "thirty-minutes" | "one-hour" | "tomorrow";

function toLocalDateValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function toLocalTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(11, 16);
}

function roundToNextFiveMinutes(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 5) * 5);
  return rounded;
}

function tomorrowAtNine(now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
}

function parseLocalSchedule(dateValue: string, timeValue: string): Date | null {
  if (!dateValue || !timeValue) return null;
  const date = new Date(`${dateValue}T${timeValue}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function ScheduleSendDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (scheduledAt: string) => void;
}) {
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<SchedulePreset | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const setSelectedDate = (date: Date, preset: SchedulePreset) => {
    const rounded = roundToNextFiveMinutes(date);
    setDateValue(toLocalDateValue(rounded));
    setTimeValue(toLocalTimeValue(rounded));
    setSelectedPreset(preset);
    setValidationError(null);
  };

  useEffect(() => {
    if (!props.open) return;
    setSelectedDate(new Date(Date.now() + 30 * 60_000), "thirty-minutes");
  }, [props.open]);

  const selectedDate = useMemo(
    () => parseLocalSchedule(dateValue, timeValue),
    [dateValue, timeValue],
  );
  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(selectedDate);
  }, [selectedDate]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedDate || selectedDate.getTime() <= Date.now()) {
      setValidationError("Choose a date and time in the future.");
      return;
    }
    props.onSchedule(selectedDate.toISOString());
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-sm overflow-hidden" bottomStickOnMobile={false}>
        <form className="contents" onSubmit={submit}>
          <DialogHeader className="gap-1.5 px-5 pt-5 pb-3">
            <DialogTitle className="text-lg">Schedule message</DialogTitle>
            <DialogDescription>Choose when this prompt should be sent.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 pt-1 pb-5">
            <div className="grid grid-cols-3 gap-2" aria-label="Quick schedule options">
              {[
                {
                  id: "thirty-minutes" as const,
                  label: "30 min",
                  date: () => new Date(Date.now() + 30 * 60_000),
                },
                {
                  id: "one-hour" as const,
                  label: "1 hour",
                  date: () => new Date(Date.now() + 60 * 60_000),
                },
                {
                  id: "tomorrow" as const,
                  label: "Tomorrow",
                  date: () => tomorrowAtNine(new Date()),
                },
              ].map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={selectedPreset === preset.id}
                  className={cn(
                    "rounded-lg transition-colors",
                    selectedPreset === preset.id &&
                      "border-sky-500/50 bg-sky-500/15 text-sky-700 shadow-sky-500/10 hover:bg-sky-500/20 dark:text-sky-300",
                  )}
                  onClick={() => setSelectedDate(preset.date(), preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
              <label className="space-y-1.5 text-sm font-medium" htmlFor="scheduled-send-date">
                <span className="block">Date</span>
                <Input
                  nativeInput
                  id="scheduled-send-date"
                  type="date"
                  min={toLocalDateValue(new Date())}
                  value={dateValue}
                  onChange={(event) => {
                    setDateValue(event.currentTarget.value);
                    setSelectedPreset(null);
                    setValidationError(null);
                  }}
                  aria-invalid={validationError ? true : undefined}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium" htmlFor="scheduled-send-time">
                <span className="block">Time</span>
                <Input
                  nativeInput
                  id="scheduled-send-time"
                  type="time"
                  step={300}
                  value={timeValue}
                  onChange={(event) => {
                    setTimeValue(event.currentTarget.value);
                    setSelectedPreset(null);
                    setValidationError(null);
                  }}
                  aria-invalid={validationError ? true : undefined}
                />
              </label>
            </div>

            <div
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-lg border px-3 text-sm",
                validationError
                  ? "border-destructive/40 bg-destructive/5 text-destructive-foreground"
                  : "border-sky-500/20 bg-sky-500/[0.06] text-foreground",
              )}
            >
              <TimerIcon
                className={cn(
                  "size-4 shrink-0",
                  validationError ? "text-destructive-foreground" : "text-sky-500",
                )}
                aria-hidden="true"
              />
              <span>{validationError ?? selectedDateLabel ?? "Choose a date and time"}</span>
            </div>
            <p className="text-xs text-secondary-label">
              Runs on this device while T3 Code is open.
            </p>
          </div>

          <DialogFooter className="border-t border-border/70 bg-muted/40 px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Schedule</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
