import { CheckIcon, CircleDotIcon, CircleIcon, ListTodoIcon } from "lucide-react";
import { memo, useId, useState } from "react";

import { formatDuration, type ActivePlanState } from "../../session-logic";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";

type ComposerTaskStep = ActivePlanState["steps"][number];
interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly live: boolean;
}

const MAX_TASK_SEGMENTS = 10;

const taskStatusLabels = {
  pending: "Pending",
  inProgress: "Running",
  completed: "Completed",
} satisfies Record<ComposerTaskStep["status"], string>;

function keyedTaskSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

function TaskSegments({
  className,
  steps,
}: {
  readonly className?: string;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (steps.length <= 1 || steps.length > MAX_TASK_SEGMENTS) return null;

  return (
    <span aria-hidden className={cn("flex w-10 shrink-0 items-center gap-0.5", className)}>
      {keyedTaskSteps(steps).map(({ key, step }) => (
        <span
          key={key}
          className={cn(
            "h-[3px] min-w-0 flex-1 rounded-full",
            step.status === "completed"
              ? "bg-success"
              : step.status === "inProgress"
                ? "bg-primary"
                : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

function TaskSummary({
  expanded,
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  return (
    <>
      <ComposerBanner.Icon>
        <ListTodoIcon />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="shrink-0 text-muted-foreground">Tasks</span>
        <span
          className="min-w-0 flex-1 truncate text-left font-medium text-foreground/80"
          data-composer-task-current="true"
        >
          {progress.step}
        </span>
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        <ComposerBanner.Count
          className={progress.completedSteps >= progress.totalSteps ? "text-success" : undefined}
          data-composer-task-progress="true"
        >
          {progress.completedSteps}/{progress.totalSteps}
        </ComposerBanner.Count>
        <TaskSegments className="hidden w-20 @min-[560px]:flex" steps={steps} />
        <ComposerBanner.ToggleIcon expanded={expanded} />
      </ComposerBanner.Actions>
    </>
  );
}

export const ComposerTasksControl = memo(function ComposerTasksControl({
  plan,
  live,
}: {
  readonly plan: ActivePlanState;
  readonly live: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (plan.steps.length === 0) return null;
  const steps = plan.steps;
  const progress = {
    step:
      steps.find((step) => step.status === "inProgress")?.step ??
      steps.find((step) => step.status === "pending")?.step ??
      steps[steps.length - 1]!.step,
    completedSteps: steps.filter((step) => step.status === "completed").length,
    totalSteps: steps.length,
    live,
  };
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root role="region" aria-label="Tasks">
        <div
          data-chat-composer-collapsed-controls="true"
          data-chat-composer-tasks-drawer={expanded ? "true" : undefined}
        >
          <ComposerBanner.Row
            render={<button type="button" />}
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={`${expanded ? "Collapse tasks" : "Tasks"}: ${progress.completedSteps} of ${progress.totalSteps} complete. Current task: ${progress.step}`}
            data-composer-tasks-badge="true"
            onClick={() => setExpanded((value) => !value)}
            onPointerDown={(event) => event.preventDefault()}
          >
            <TaskSummary expanded={expanded} progress={progress} steps={steps} />
          </ComposerBanner.Row>
          {expanded ? (
            <ComposerBanner.Scroll data-composer-tasks-scroll="true">
              <ComposerBanner.Children
                render={<ul role="list" />}
                aria-label={`Task list. ${progress.completedSteps} of ${progress.totalSteps} complete.`}
                data-composer-tasks-list="true"
                id={listId}
              >
                {keyedTaskSteps(steps).map(({ key, step }) => (
                  <ComposerBanner.Row key={key} render={<li />} className="items-start py-1 pe-2">
                    <ComposerBanner.Icon
                      className={cn(
                        "h-4",
                        step.status === "completed"
                          ? "text-success"
                          : step.status === "inProgress"
                            ? "text-primary"
                            : "text-muted-foreground/40",
                      )}
                    >
                      {step.status === "completed" ? (
                        <CheckIcon />
                      ) : step.status === "inProgress" ? (
                        <CircleDotIcon />
                      ) : (
                        <CircleIcon />
                      )}
                    </ComposerBanner.Icon>
                    <ComposerBanner.Content
                      className={cn(
                        "block wrap-anywhere",
                        step.status === "completed"
                          ? "text-muted-foreground/55"
                          : step.status === "inProgress"
                            ? "text-foreground/90"
                            : "text-muted-foreground/70",
                      )}
                    >
                      <span className="sr-only">{taskStatusLabels[step.status]}: </span>
                      {step.step}
                    </ComposerBanner.Content>
                    <ComposerBanner.Actions>
                      <span
                        className="min-w-12 text-right text-3xs/4 whitespace-nowrap text-muted-foreground/45 tabular-nums"
                        data-composer-task-duration="true"
                      >
                        {step.durationMs !== undefined
                          ? formatDuration(step.durationMs)
                          : step.status === "inProgress" && progress.live
                            ? "now"
                            : null}
                      </span>
                    </ComposerBanner.Actions>
                  </ComposerBanner.Row>
                ))}
              </ComposerBanner.Children>
            </ComposerBanner.Scroll>
          ) : null}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
});
