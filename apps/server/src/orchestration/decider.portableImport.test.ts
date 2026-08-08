import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";

const importedThread: OrchestrationThread = {
  id: ThreadId.make("portable-thread"),
  projectId: ProjectId.make("source-project"),
  title: "Portable conversation",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/old-device",
  worktreePath: "C:\\old-device\\project-worktree",
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: MessageId.make("assistant-1"),
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [
    {
      id: MessageId.make("assistant-1"),
      role: "assistant",
      text: "Implemented the first half",
      turnId: TurnId.make("turn-1"),
      streaming: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId: ThreadId.make("portable-thread"),
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.make("turn-1"),
    lastError: null,
    updatedAt: now,
  },
};

it.layer(NodeServices.layer)("portable conversation import decider", (it) => {
  it.effect("imports canonical history while dropping device-local runtime state", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("target-project");
      const readModel = yield* projectEvent(createEmptyReadModel(now), {
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
          title: "Target",
          workspaceRoot: "/current/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.portable.import",
          commandId: CommandId.make("import-thread"),
          projectId,
          thread: importedThread,
          createdAt: now,
        },
        readModel,
      });
      const event = (Array.isArray(result) ? result[0] : result) as Omit<
        OrchestrationEvent,
        "sequence"
      >;
      if (event.type !== "thread.portable-imported") {
        throw new Error("Expected one portable import event.");
      }
      const portableEvent = event as Extract<
        OrchestrationEvent,
        { type: "thread.portable-imported" }
      >;

      expect(portableEvent.aggregateId).toBe(importedThread.id);
      expect(portableEvent.payload.thread.projectId).toBe(projectId);
      expect(portableEvent.payload.thread.branch).toBeNull();
      expect(portableEvent.payload.thread.worktreePath).toBeNull();
      expect(portableEvent.payload.thread.session).toBeNull();
      expect(portableEvent.payload.thread.latestTurn?.state).toBe("interrupted");
      expect(portableEvent.payload.thread.latestTurn?.completedAt).toBe(now);
      expect(portableEvent.payload.thread.messages[0]).toMatchObject({
        text: "Implemented the first half",
        streaming: false,
      });

      const projected = yield* projectEvent(readModel, {
        ...portableEvent,
        sequence: 2,
      } as OrchestrationEvent);
      expect(projected.threads[0]).toEqual(portableEvent.payload.thread);
    }),
  );
});
