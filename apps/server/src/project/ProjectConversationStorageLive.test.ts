// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  PortableConversationDocument,
  PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
  ProjectId,
  ProjectScript,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { PortableConversationContext } from "../orchestration/Services/PortableConversationContext.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { createEmptyReadModel } from "../orchestration/projector.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProjectConversationStorage } from "./ProjectConversationStorage.ts";
import { ProjectConversationStorageLive } from "./ProjectConversationStorageLive.ts";

const encodeDocument = Schema.encodeSync(Schema.fromJsonString(PortableConversationDocument));
const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(PortableConversationDocument),
);
const PortableManifestJson = Schema.fromJsonString(
  Schema.Struct({
    schemaVersion: Schema.Literal(PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION),
    enabled: Schema.Boolean,
    updatedAt: Schema.String,
    scripts: Schema.optionalKey(Schema.Array(ProjectScript)),
  }),
);
const encodeManifest = Schema.encodeSync(PortableManifestJson);
const decodeManifest = Schema.decodeUnknownSync(PortableManifestJson);
const temporaryDirectories = new Set<string>();

function makeTemporaryDirectory(prefix: string) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function makeThread(input: {
  id: string;
  projectId: ProjectId;
  updatedAt: string;
  text: string;
}): OrchestrationThread {
  return {
    id: ThreadId.make(input.id),
    projectId: input.projectId,
    title: input.id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make(`${input.id}-message`),
        role: "assistant",
        text: input.text,
        turnId: null,
        streaming: false,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

describe("ProjectConversationStorageLive", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.clear();
  });

  it.effect(
    "imports portable conversations and project actions before keeping both copies current",
    () =>
      Effect.gen(function* () {
        const workspaceRoot = makeTemporaryDirectory("t3-portable-project-");
        const baseDir = makeTemporaryDirectory("t3-portable-state-");
        const projectId = ProjectId.make("project-1");
        const oldThread = makeThread({
          id: "shared-thread",
          projectId,
          updatedAt: "2026-01-01T00:00:01.000Z",
          text: "old local history",
        });
        const localOnlyThread = makeThread({
          id: "local-only-thread",
          projectId,
          updatedAt: "2026-01-01T00:00:02.000Z",
          text: "existing local history",
        });
        const portableThread = makeThread({
          id: "shared-thread",
          projectId: ProjectId.make("project-on-other-device"),
          updatedAt: "2026-01-02T00:00:00.000Z",
          text: "new portable history",
        });
        const portableScripts = [
          {
            id: "review",
            name: "Review",
            kind: "prompt",
            prompt: "Review the current changes",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            icon: "debug",
            runOnWorktreeCreate: false,
          },
        ] as const;
        const project = {
          id: projectId,
          title: "Project",
          workspaceRoot,
          defaultModelSelection: null,
          scripts: [
            {
              id: "old-local-action",
              name: "Old local action",
              command: "echo old",
              icon: "play",
              runOnWorktreeCreate: false,
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        } as const;
        let readModel: OrchestrationReadModel = {
          ...createEmptyReadModel("2026-01-01T00:00:00.000Z"),
          projects: [project],
          threads: [oldThread, localOnlyThread],
        };
        const pending = new Set<ThreadId>();
        const threadsDirectory = NodePath.join(workspaceRoot, ".t3", "conversations", "threads");
        NodeFS.mkdirSync(threadsDirectory, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(threadsDirectory, "shared-thread.json"),
          encodeDocument({
            schemaVersion: PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
            exportedAt: "2026-01-02T00:00:01.000Z",
            sourceProvider: ProviderDriverKind.make("codex"),
            thread: portableThread,
          }),
        );
        NodeFS.writeFileSync(
          NodePath.join(workspaceRoot, ".t3", "conversations", "manifest.json"),
          encodeManifest({
            schemaVersion: PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
            enabled: true,
            updatedAt: "2026-01-02T00:00:01.000Z",
            scripts: portableScripts,
          }),
        );

        const nextDomainEvent = yield* Deferred.make<OrchestrationEvent>();
        const domainEventHandled = yield* Deferred.make<void>();
        const domainEvents = Stream.concat(
          Stream.fromEffect(Deferred.await(nextDomainEvent)),
          Stream.fromEffect(
            Deferred.succeed(domainEventHandled, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        );

        const configLayer = Layer.effect(
          ServerConfig,
          Effect.gen(function* () {
            const config = yield* ServerConfig;
            return ServerConfig.of({ ...config, mode: "desktop" });
          }),
        ).pipe(Layer.provide(ServerConfig.layerTest(workspaceRoot, baseDir)));
        const engineLayer = Layer.succeed(OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: (command: OrchestrationCommand) =>
            Effect.sync(() => {
              if (command.type === "thread.portable.import") {
                const existingIndex = readModel.threads.findIndex(
                  (thread) => thread.id === command.thread.id,
                );
                readModel = {
                  ...readModel,
                  threads:
                    existingIndex === -1
                      ? [...readModel.threads, command.thread]
                      : readModel.threads.map((thread, index) =>
                          index === existingIndex ? command.thread : thread,
                        ),
                };
              }
              if (command.type === "project.meta.update" && command.scripts !== undefined) {
                readModel = {
                  ...readModel,
                  projects: readModel.projects.map((current) =>
                    current.id === command.projectId
                      ? { ...current, scripts: command.scripts ?? current.scripts }
                      : current,
                  ),
                };
              }
              return { sequence: readModel.snapshotSequence + 1 };
            }),
          get streamDomainEvents() {
            return domainEvents;
          },
          latestSequence: Effect.succeed(0),
        });
        const snapshotsLayer = Layer.mock(ProjectionSnapshotQuery)({
          getSnapshot: () => Effect.sync(() => readModel),
          getProjectShellById: (id) =>
            Effect.sync(() =>
              Option.fromNullishOr(readModel.projects.find((current) => current.id === id)),
            ),
          getThreadDetailById: (id) =>
            Effect.sync(() =>
              Option.fromNullishOr(readModel.threads.find((thread) => thread.id === id)),
            ),
        });

        const storageLayer = ProjectConversationStorageLive.pipe(
          Layer.provideMerge(engineLayer),
          Layer.provideMerge(snapshotsLayer),
          Layer.provideMerge(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) })),
          Layer.provideMerge(
            Layer.succeed(PortableConversationContext, {
              isPending: (threadId) => Effect.sync(() => pending.has(threadId)),
              markPending: (threadId) => Effect.sync(() => void pending.add(threadId)),
              markRestored: (threadId) => Effect.sync(() => void pending.delete(threadId)),
            }),
          ),
          Layer.provideMerge(configLayer),
          Layer.provide(NodeServices.layer),
        );

        yield* Effect.gen(function* () {
          const storage = yield* ProjectConversationStorage;
          yield* storage.start();
          const state = yield* storage.setEnabled({ projectId, enabled: true });

          expect(state).toMatchObject({ enabled: true, exportedThreadCount: 2 });
          expect(pending.has(ThreadId.make("shared-thread"))).toBe(true);
          expect(
            readModel.threads.find((thread) => thread.id === "shared-thread")?.messages[0]?.text,
          ).toBe("new portable history");
          expect(readModel.projects[0]?.scripts).toEqual(portableScripts);

          const exportedShared = decodeDocument(
            NodeFS.readFileSync(NodePath.join(threadsDirectory, "shared-thread.json"), "utf8"),
          );
          const exportedLocal = decodeDocument(
            NodeFS.readFileSync(NodePath.join(threadsDirectory, "local-only-thread.json"), "utf8"),
          );
          expect(exportedShared.thread.projectId).toBe(projectId);
          expect(exportedShared.thread.messages[0]?.text).toBe("new portable history");
          expect(exportedLocal.thread.messages[0]?.text).toBe("existing local history");

          const updatedScripts = [
            {
              id: "test",
              name: "Test",
              command: "vp test",
              icon: "test",
              runOnWorktreeCreate: false,
            },
          ] as const;
          readModel = {
            ...readModel,
            projects: readModel.projects.map((current) =>
              current.id === projectId
                ? { ...current, scripts: Array.from(updatedScripts) }
                : current,
            ),
          };
          yield* Deferred.succeed(nextDomainEvent, {
            sequence: 1,
            eventId: EventId.make("portable-project-actions-updated"),
            aggregateKind: "project",
            aggregateId: projectId,
            type: "project.meta-updated",
            occurredAt: "2026-01-03T00:00:00.000Z",
            commandId: CommandId.make("update-project-actions"),
            causationEventId: null,
            correlationId: CommandId.make("update-project-actions"),
            metadata: {},
            payload: {
              projectId,
              scripts: Array.from(updatedScripts),
              updatedAt: "2026-01-03T00:00:00.000Z",
            },
          });
          yield* Deferred.await(domainEventHandled);

          const manifest = decodeManifest(
            NodeFS.readFileSync(
              NodePath.join(workspaceRoot, ".t3", "conversations", "manifest.json"),
              "utf8",
            ),
          );
          expect(manifest.scripts).toEqual(updatedScripts);

          const disabled = yield* storage.setEnabled({ projectId, enabled: false });
          expect(disabled.enabled).toBe(false);
          expect(NodeFS.existsSync(NodePath.join(threadsDirectory, "shared-thread.json"))).toBe(
            true,
          );
        }).pipe(Effect.provide(storageLayer));
      }),
  );
});
