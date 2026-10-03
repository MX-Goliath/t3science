import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  EnvironmentId,
  ThreadId,
  RunId,
  ProviderInstanceId,
  MessageId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import { makeThreadProjectionFixture } from "./test-fixtures";
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

const now = DateTime.makeUnsafe("2026-09-26T12:00:00Z");
const ref = { environmentId: EnvironmentId.make("environment"), threadId: ThreadId.make("thread") };
const run: OrchestrationV2Run = {
  id: RunId.make("run"),
  threadId: ref.threadId,
  ordinal: 1,
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
  providerThreadId: null,
  userMessageId: MessageId.make("user"),
  rootNodeId: null,
  activeAttemptId: null,
  status: "completed",
  requestedAt: now,
  startedAt: now,
  completedAt: now,
  checkpointId: null,
  contextHandoffId: null,
};
const thread = { ...makeThreadProjectionFixture(), runs: [run] };
const expected = {
  latestRun: {
    runId: run.id,
    status: run.status,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    assistantMessageId: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.value = {
    data: Option.some(thread),
    status: "live",
    error: Option.none(),
    history: {
      historyCursor: null,
      hasMoreHistory: false,
      loading: false,
      error: null,
      expanded: false,
      latestLocalTurnOrdinal: null,
    },
  };
});

it("uses loaded live details immediately and releases the subscription", () => {
  const ready = vi.fn();
  watchThreadNotificationDetail(ref, expected, "done", ready);
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
      runs: [{ ...run, status: "running", completedAt: null }],
    }),
  };
  watchThreadNotificationDetail(ref, expected, "done", ready);
  expect(ready).not.toHaveBeenCalled();
  state.value = { ...state.value, data: Option.some(thread) };
  state.inspect();
  expect(ready).toHaveBeenCalledExactlyOnceWith(thread);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it("does not use stale cached details and cancels pending work", () => {
  const ready = vi.fn();
  state.value = { ...state.value!, status: "cached" };
  const cancel = watchThreadNotificationDetail(ref, expected, "done", ready);
  expect(ready).not.toHaveBeenCalled();
  cancel();
  state.value = { ...state.value, status: "live" };
  state.inspect();
  expect(ready).not.toHaveBeenCalled();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it("waits for the actual question payload before presenting input alerts", () => {
  const ready = vi.fn();
  watchThreadNotificationDetail(ref, expected, "input", ready);
  expect(ready).not.toHaveBeenCalled();
  const withQuestion = {
    ...thread,
    turnItems: [
      {
        id: TurnItemId.make("question"),
        threadId: ref.threadId,
        runId: run.id,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "running" as const,
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        type: "user_input_request" as const,
        requestId: RuntimeRequestId.make("request"),
        questions: [{ id: "choice", header: "Choice", question: "Which version?", options: [] }],
      },
    ],
  };
  state.value = { ...state.value!, data: Option.some(withQuestion) };
  state.inspect();
  expect(ready).toHaveBeenCalledExactlyOnceWith(withQuestion);
});

it("falls back when the detail cannot be loaded", () => {
  const ready = vi.fn();
  state.value = { ...state.value!, data: Option.none(), error: Option.some("Disconnected") };
  watchThreadNotificationDetail(ref, expected, "error", ready);
  expect(ready).toHaveBeenCalledExactlyOnceWith(null);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
