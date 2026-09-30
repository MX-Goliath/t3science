import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import { EnvironmentId, OrchestrationThread, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  value: null as EnvironmentThreadState | null,
  inspect: () => {},
  unsubscribe: vi.fn(),
}));
vi.mock("./rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => state.value,
    subscribe: (_atom: unknown, inspect: () => void) => {
      state.inspect = inspect;
      return state.unsubscribe;
    },
  },
}));
vi.mock("./state/threads", () => ({
  environmentThreadDetails: { stateAtom: () => "thread-state" },
}));

import { watchThreadNotificationDetail } from "./threadNotificationDetail";

const now = "2026-09-26T12:00:00Z";
const ref = { environmentId: EnvironmentId.make("environment"), threadId: ThreadId.make("thread") };
const decodeThread = Schema.decodeSync(OrchestrationThread);
const thread = decodeThread({
  id: "thread",
  projectId: "project",
  title: "Test thread",
  modelSelection: { instanceId: "codex", model: "gpt" },
  runtimeMode: "full-access",
  branch: null,
  worktreePath: null,
  latestTurn: {
    turnId: "turn",
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  },
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  messages: [],
  activities: [],
  checkpoints: [],
  session: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.value = {
    data: Option.some(thread),
    status: "live",
    error: Option.none(),
    page: Option.none(),
  };
});

it("uses loaded live details immediately and releases the subscription", () => {
  const ready = vi.fn();
  watchThreadNotificationDetail(ref, thread, "done", ready);
  expect(ready).toHaveBeenCalledExactlyOnceWith(thread);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  state.inspect();
  expect(ready).toHaveBeenCalledOnce();
});

it("waits for the detail stream to catch up with the completed shell", () => {
  const ready = vi.fn();
  state.value = {
    ...state.value!,
    data: Option.some({
      ...thread,
      latestTurn: { ...thread.latestTurn!, state: "running", completedAt: null },
    }),
  };
  watchThreadNotificationDetail(ref, thread, "done", ready);
  expect(ready).not.toHaveBeenCalled();
  state.value = { ...state.value, data: Option.some(thread) };
  state.inspect();
  expect(ready).toHaveBeenCalledExactlyOnceWith(thread);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it("does not use stale cached details and cancels pending work", () => {
  const ready = vi.fn();
  state.value = { ...state.value!, status: "cached" };
  const cancel = watchThreadNotificationDetail(ref, thread, "done", ready);
  expect(ready).not.toHaveBeenCalled();
  cancel();
  state.value = { ...state.value, status: "live" };
  state.inspect();
  expect(ready).not.toHaveBeenCalled();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it("waits for the actual question payload before presenting input alerts", () => {
  const ready = vi.fn();
  watchThreadNotificationDetail(ref, thread, "input", ready);
  expect(ready).not.toHaveBeenCalled();
  const withQuestion = decodeThread({
    ...thread,
    activities: [
      {
        id: "question",
        tone: "info",
        kind: "user-input.requested",
        summary: "Input needed",
        turnId: "turn",
        createdAt: now,
        payload: {
          requestId: "request",
          questions: [{ id: "choice", header: "Choice", question: "Which version?", options: [] }],
        },
      },
    ],
  });
  state.value = { ...state.value!, data: Option.some(withQuestion) };
  state.inspect();
  expect(ready).toHaveBeenCalledExactlyOnceWith(withQuestion);
});

it("falls back when the detail cannot be loaded", () => {
  const ready = vi.fn();
  state.value = { ...state.value!, data: Option.none(), error: Option.some("Disconnected") };
  watchThreadNotificationDetail(ref, thread, "error", ready);
  expect(ready).toHaveBeenCalledExactlyOnceWith(null);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
