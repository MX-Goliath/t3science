import {
  ProviderInstanceId,
  MessageId,
  RunId,
  ThreadId,
  RuntimeRequestId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { makeThreadProjectionFixture } from "./test-fixtures";
import { threadNotificationContent } from "./threadNotificationContent";

const now = DateTime.makeUnsafe("2026-09-26T12:00:00Z");
const runId = RunId.make("current");
const thread = {
  title: "Исправить вход",
  latestRun: {
    runId,
    status: "completed" as const,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    assistantMessageId: null,
  },
  runtime: null,
};
const detail = makeThreadProjectionFixture();
const message = (text: string, id = runId) => ({
  id: MessageId.make(text),
  threadId: ThreadId.make("thread"),
  runId: id,
  nodeId: null,
  createdBy: "agent" as const,
  creationSource: "server" as const,
  role: "assistant" as const,
  text,
  streaming: false,
  attachments: [],
  createdAt: now,
  updatedAt: now,
});
it("includes the current final answer and strips formatting", () => {
  expect(
    threadNotificationContent(thread, "done", {
      ...detail,
      messages: [
        message("Old answer", RunId.make("old")),
        message("## Готово\nИсправил **проверку пароля**."),
      ],
    }),
  ).toEqual({ title: "Done · Исправить вход", body: "Готово Исправил проверку пароля." });
});
it("includes pending questions, ignoring answered requests", () => {
  const base = {
    id: TurnItemId.make("q"),
    threadId: detail.thread.id,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    title: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    type: "user_input_request" as const,
    requestId: RuntimeRequestId.make("request"),
    questions: [{ id: "q", header: "Choice", question: "Which version?", options: [] }],
  };
  expect(
    threadNotificationContent(thread, "input", {
      ...detail,
      turnItems: [{ ...base, status: "running" }],
    }).body,
  ).toBe("Which version?");
  expect(
    threadNotificationContent(thread, "input", {
      ...detail,
      turnItems: [{ ...base, status: "completed" }],
    }).body,
  ).toBe("The model is waiting for your answer.");
});
it("falls back without stale answers and limits long notification bodies", () => {
  expect(
    threadNotificationContent(thread, "done", {
      ...detail,
      messages: [message("Stale", RunId.make("old"))],
    }).body,
  ).toBe("The model finished its response.");
  expect(
    threadNotificationContent(thread, "done", { ...detail, messages: [message("x".repeat(1000))] })
      .body.length,
  ).toBe(320);
});
it("uses provider errors even when details cannot load", () => {
  const runtime = {
    status: "failed" as const,
    activeRunId: null,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    lastError: "Command failed",
    updatedAt: "2026-09-26T12:00:00Z",
  };
  expect(threadNotificationContent({ ...thread, runtime }, "error", null).body).toBe(
    "Command failed",
  );
});
