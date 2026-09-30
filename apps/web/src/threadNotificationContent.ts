import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import type { OrchestrationThread, OrchestrationThreadShell } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

export type ThreadNotificationKind = "done" | "input" | "approval" | "error";
type NotificationThread = Pick<OrchestrationThreadShell, "title" | "latestTurn" | "session">;
type NotificationDetail = Pick<
  OrchestrationThread,
  "messages" | "activities" | "proposedPlans" | "latestTurn" | "session"
>;

const labels = { done: "Done", input: "Input needed", approval: "Approval needed", error: "Error" };
const fallbacks = {
  done: "The model finished its response.",
  input: "The model is waiting for your answer.",
  approval: "The model needs your permission to continue.",
  error: "The model could not finish the task. Open the thread for details.",
};

/** Keep a short, readable beginning of the text without formatting markers. */
function preview(text: string, limit: number) {
  const plain = text
    .slice(0, 4096)
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-*]\s+)/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

export function threadNotificationContent(
  thread: NotificationThread,
  kind: ThreadNotificationKind,
  detail: NotificationDetail | null,
) {
  const current = detail?.latestTurn?.turnId === thread.latestTurn?.turnId ? detail : null;
  let text: string | undefined;
  if (kind === "done" && current) {
    text = current.messages.findLast(
      (message) =>
        message.role === "assistant" &&
        message.turnId === thread.latestTurn?.turnId &&
        message.text.trim(),
    )?.text;
    text ||= current.proposedPlans.findLast(
      (plan) => plan.turnId === thread.latestTurn?.turnId,
    )?.planMarkdown;
  } else if (kind === "input" && current) {
    text = derivePendingRequests(current.activities)
      .userInputs[0]?.questions.map((question) => question.question)
      .join(" ");
  } else if (kind === "approval" && current) {
    const approval = derivePendingRequests(current.activities).approvals[0];
    text = approval?.detail ?? approval?.appName ?? approval?.requestKind;
  } else if (kind === "error") {
    const activity = current?.activities.findLast(
      (activity) => activity.tone === "error" && activity.turnId === thread.latestTurn?.turnId,
    );
    const payload = activity?.payload;
    const errorDetail = Predicate.isObject(payload)
      ? typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.message === "string"
          ? payload.message
          : undefined
      : undefined;
    text =
      thread.session?.lastError ?? current?.session?.lastError ?? errorDetail ?? activity?.summary;
  }
  return {
    title: `${labels[kind]} · ${preview(thread.title, 180)}`,
    body: preview(text ?? "", 320) || fallbacks[kind],
  };
}
