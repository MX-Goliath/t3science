import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export type ThreadNotificationKind = "done" | "input" | "approval" | "error" | "limited";
type NotificationThread = Pick<EnvironmentThreadShell, "title" | "latestRun" | "runtime">;
type NotificationDetail = OrchestrationV2ThreadProjection;

const labels = {
  done: "Done",
  input: "Input needed",
  approval: "Approval needed",
  error: "Error",
  limited: "Usage limit reached",
};
const fallbacks = {
  done: "The model finished its response.",
  input: "The model is waiting for your answer.",
  approval: "The model needs your permission to continue.",
  error: "The model could not finish the task. Open the thread for details.",
  limited: "The provider usage limit was reached.",
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
  const runId = thread.latestRun?.runId;
  const items = detail?.turnItems.filter((item) => item.runId === runId) ?? [];
  let text: string | undefined;
  if (kind === "done") {
    text = detail?.messages.findLast(
      (message) => message.role === "assistant" && message.runId === runId && message.text.trim(),
    )?.text;
    const plan = items.findLast((item) => item.type === "proposed_plan");
    if (!text && plan?.type === "proposed_plan") text = plan.markdown;
  } else if (kind === "input") {
    const question = items.findLast(
      (item) => item.type === "user_input_request" && item.status !== "completed",
    );
    if (question?.type === "user_input_request")
      text = question.questions.map((question) => question.question).join(" ");
  } else if (kind === "approval") {
    const approval = items.findLast(
      (item) => item.type === "approval_request" && item.status !== "completed",
    );
    if (approval?.type === "approval_request")
      text = approval.prompt ?? approval.appName ?? approval.requestKind;
  } else if (kind === "error" || kind === "limited") {
    const error = items.findLast((item) => item.type === "error");
    text =
      thread.runtime?.lastError ?? (error?.type === "error" ? error.failure.message : undefined);
  }
  return {
    title: `${labels[kind]} · ${preview(thread.title, 180)}`,
    body: preview(text ?? "", 320) || fallbacks[kind],
  };
}
