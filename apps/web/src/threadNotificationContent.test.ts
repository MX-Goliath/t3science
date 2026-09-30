import { EventId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { threadNotificationContent } from "./threadNotificationContent";

const now = "2026-09-26T12:00:00Z";
const thread: Parameters<typeof threadNotificationContent>[0] = {
  title: "Исправить вход",
  latestTurn: {
    turnId: TurnId.make("current"),
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  },
  session: null,
};
type Detail = NonNullable<Parameters<typeof threadNotificationContent>[2]>;
const detail = (overrides: Partial<Detail> = {}): Detail => ({
  latestTurn: thread.latestTurn,
  messages: [],
  activities: [],
  proposedPlans: [],
  session: null,
  ...overrides,
});
const message = (
  role: Detail["messages"][number]["role"],
  text: string,
  turn = "current",
): Detail["messages"][number] => ({
  id: MessageId.make(`${role}-${turn}`),
  role,
  text,
  turnId: TurnId.make(turn),
  streaming: false,
  createdAt: now,
  updatedAt: now,
});
const activity = (
  kind: string,
  payload: Record<string, unknown>,
): Detail["activities"][number] => ({
  id: EventId.make(kind),
  kind,
  payload,
  tone: "info",
  summary: "Activity summary",
  turnId: TurnId.make("current"),
  createdAt: now,
});

it("shows the beginning of the current final answer, excluding reasoning and older turns", () => {
  const content = threadNotificationContent(
    thread,
    "done",
    detail({
      messages: [
        message("assistant", "Old answer", "old"),
        message("assistant", "Checking the code"),
        message("assistant", "## Готово\n\nИсправил **проверку пароля**.\nТесты прошли."),
        message("reasoning", "Private reasoning"),
      ],
    }),
  );
  expect(content).toEqual({
    title: "Done · Исправить вход",
    body: "Готово Исправил проверку пароля. Тесты прошли.",
  });
});

it("includes the actual pending question, ignoring answered questions", () => {
  const question = (id: string, text: string) =>
    activity("user-input.requested", {
      requestId: id,
      questions: [{ id, header: "Choice", question: text, options: [] }],
    });
  const content = threadNotificationContent(
    thread,
    "input",
    detail({
      activities: [
        question("old", "Old question?"),
        activity("user-input.resolved", { requestId: "old" }),
        question("new", "Какой способ авторизации использовать?"),
      ],
    }),
  );
  expect(content).toEqual({
    title: "Input needed · Исправить вход",
    body: "Какой способ авторизации использовать?",
  });
});

it("includes the command that needs approval", () => {
  expect(
    threadNotificationContent(
      thread,
      "approval",
      detail({
        activities: [
          activity("approval.requested", {
            requestId: "request",
            requestKind: "command",
            detail: "git push origin main",
          }),
        ],
      }),
    ).body,
  ).toBe("git push origin main");
});

it("preserves command arguments and filenames in the preview", () => {
  expect(
    threadNotificationContent(
      thread,
      "approval",
      detail({
        activities: [
          activity("approval.requested", {
            requestId: "request",
            requestKind: "command",
            detail: "`run_task --files *.txt`",
          }),
        ],
      }),
    ).body,
  ).toBe("run_task --files *.txt");
});

it.each(["detail", "message"])("shows error %s instead of a generic activity summary", (key) => {
  expect(
    threadNotificationContent(
      thread,
      "error",
      detail({
        activities: [
          {
            ...activity("runtime.error", { [key]: "Connection refused on port 443" }),
            tone: "error",
          },
        ],
      }),
    ).body,
  ).toBe("Connection refused on port 443");
});

it("includes the session error instead of an older model answer", () => {
  const failed: typeof thread = {
    ...thread,
    session: {
      threadId: ThreadId.make("thread"),
      status: "error",
      providerName: null,
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: "Rate limit exceeded. Try again in 20 seconds.",
      updatedAt: now,
    },
  };
  expect(threadNotificationContent(failed, "error", detail()).body).toBe(failed.session!.lastError);
});

it("falls back to an error activity when the session has no error text", () => {
  expect(
    threadNotificationContent(
      thread,
      "error",
      detail({
        activities: [
          { ...activity("turn.failed", {}), tone: "error", summary: "Provider connection lost" },
        ],
      }),
    ).body,
  ).toBe("Provider connection lost");
});

it("bounds notification text and preserves its beginning", () => {
  const content = threadNotificationContent(
    { ...thread, title: "x".repeat(500) },
    "done",
    detail({ messages: [message("assistant", "Начало " + "x".repeat(1000))] }),
  );
  expect(content.title.length).toBeLessThan(256);
  expect(content.body).toHaveLength(320);
  expect(content.body.startsWith("Начало ")).toBe(true);
  expect(content.body.endsWith("…")).toBe(true);
});

it("never uses content from a different turn", () => {
  expect(
    threadNotificationContent(
      thread,
      "done",
      detail({
        latestTurn: { ...thread.latestTurn!, turnId: TurnId.make("old") },
        messages: [message("assistant", "Old answer", "old")],
      }),
    ).body,
  ).toBe("The model finished its response.");
});
