import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const sourceThreadId = ThreadId.make("source-thread");

const sourceThread: OrchestrationThread = {
  id: sourceThreadId,
  projectId,
  title: "Original conversation",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/source",
  worktreePath: "/tmp/source-worktree",
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [
    {
      id: MessageId.make("question"),
      role: "user",
      text: "Question",
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MessageId.make("answer"),
      role: "assistant",
      text: "Answer",
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MessageId.make("later-question"),
      role: "user",
      text: "Later question",
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

it.layer(NodeServices.layer)("conversation fork decider", (it) => {
  it.effect("forks through the selected message and clears device-local state", () =>
    Effect.gen(function* () {
      let readModel = yield* projectEvent(createEmptyReadModel(now), {
        sequence: 1,
        eventId: EventId.make("project-created"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("create-project"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      readModel = yield* projectEvent(readModel, {
        sequence: 2,
        eventId: EventId.make("source-imported"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        type: "thread.portable-imported",
        occurredAt: now,
        commandId: CommandId.make("import-source"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: { projectId, thread: sourceThread },
      } as OrchestrationEvent);

      const newThreadId = ThreadId.make("forked-thread");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.fork",
          commandId: CommandId.make("fork-thread"),
          projectId,
          sourceThreadId,
          messageId: MessageId.make("answer"),
          newThreadId,
          createdAt: now,
        },
        readModel,
      });
      const event = (Array.isArray(result) ? result[0] : result) as Extract<
        OrchestrationEvent,
        { type: "thread.portable-imported" }
      >;

      expect(event.type).toBe("thread.portable-imported");
      expect(event.aggregateId).toBe(newThreadId);
      expect(event.payload.thread.messages.map((message) => message.id)).toEqual([
        MessageId.make("question"),
        MessageId.make("answer"),
      ]);
      expect(event.payload.thread).toMatchObject({
        id: newThreadId,
        title: "Fork: Original conversation",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        session: null,
      });
    }),
  );
});
