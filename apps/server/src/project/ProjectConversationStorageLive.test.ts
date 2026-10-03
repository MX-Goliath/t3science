import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  PortableConversationDocument,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ProjectScript,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { layerTest as settingsLayerTest } from "../serverSettings.ts";
import { ServerConfig } from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import {
  OrchestrationV2EventSinkLayerLive,
  OrchestrationEventInfrastructureLayerLive,
} from "../orchestration-v2/runtimeLayer.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProjectConversationStorage } from "./ProjectConversationStorage.ts";
import {
  ProjectConversationStorageLive,
  portableThreadSnapshot,
  portableConversationHistory,
} from "./ProjectConversationStorageLive.ts";

const now = DateTime.makeUnsafe("2026-09-26T12:00:00Z");
const projectId = ProjectId.make("project");
const providerInstanceId = ProviderInstanceId.make("codex");
const thread: OrchestrationV2AppThread = {
  id: ThreadId.make("portable-thread"),
  projectId,
  title: "Portable history",
  providerInstanceId,
  modelSelection: {
    instanceId: providerInstanceId,
    model: "gpt",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  createdBy: "user",
  creationSource: "web",
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "old-machine",
  worktreePath: "/old-machine",
  activeProviderThreadId: null,
  lineage: {
    rootThreadId: ThreadId.make("portable-thread"),
    parentThreadId: null,
    relationshipToParent: null,
  },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledAt: null,
  settledOverride: null,
  lastVisitedAt: null,
  deletedAt: null,
};
const legacy = Schema.decodeUnknownSync(PortableConversationDocument)({
  schemaVersion: 1,
  exportedAt: DateTime.formatIso(now),
  sourceProvider: "codex",
  thread: {
    ...thread,
    createdAt: DateTime.formatIso(now),
    updatedAt: DateTime.formatIso(now),
    messages: [
      {
        id: "answer",
        role: "assistant",
        text: "Keep this answer",
        modelSelection: thread.modelSelection,
        createdAt: DateTime.formatIso(now),
        updatedAt: DateTime.formatIso(now),
      },
    ],
  },
});
it("converts legacy files without losing answer models or history", () => {
  const restored = portableThreadSnapshot(ProjectId.make("destination"), legacy);
  assert.equal(restored.thread.projectId, "destination");
  assert.isNull(restored.thread.worktreePath);
  assert.equal(restored.thread.historyOrigin, "v1_import");
  assert.equal(restored.messages[0]?.text, "Keep this answer");
  assert.deepStrictEqual(restored.messages[0]?.modelSelection, thread.modelSelection);
  assert.equal(restored.turnItems[0]?.type, "assistant_message");
});

it("exports the inherited fork prefix and retains its model metadata", () => {
  const snapshot = portableThreadSnapshot(projectId, legacy);
  const item = snapshot.turnItems[0]!;
  const message = snapshot.messages[0]!;
  const parent = { ...snapshot, runs: [], visibleTurnItems: [] };
  const child = {
    messages: [],
    runs: [],
    turnItems: [],
    visibleTurnItems: [
      {
        position: 0,
        visibility: "inherited" as const,
        sourceThreadId: thread.id,
        sourceItemId: item.id,
        item,
      },
    ],
  };
  const history = portableConversationHistory(child, [
    {
      ...parent,
      messages: [
        message,
        { ...message, id: MessageId.make("after-fork"), text: "Later parent answer" },
      ],
    },
  ]);
  assert.deepStrictEqual(
    history.messages.map((entry) => entry.text),
    ["Keep this answer"],
  );
  assert.deepStrictEqual(history.messages[0]?.modelSelection, thread.modelSelection);
  assert.equal(history.turnItems.length, 1);
  assert.deepStrictEqual(
    portableThreadSnapshot(projectId, {
      schemaVersion: 2,
      exportedAt: DateTime.formatIso(now),
      sourceProvider: ProviderDriverKind.make("codex"),
      thread,
      ...history,
    }).messages[0]?.modelSelection,
    thread.modelSelection,
  );
});

const database = SqlitePersistenceMemory;
const stores = Layer.mergeAll(
  ProjectionStore.layer,
  ProjectStore.layer,
  OrchestrationEventInfrastructureLayerLive,
).pipe(Layer.provideMerge(database));
const sink = OrchestrationV2EventSinkLayerLive.pipe(Layer.provideMerge(stores));
it.effect(
  "imports old snapshots, exports V2, preserves project actions and disables mirroring without deleting files",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "science-portable-" });
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "science-portable-state-" });
      const directory = path.join(root, ".t3", "conversations");
      yield* fs.makeDirectory(path.join(directory, "threads"), { recursive: true });
      yield* fs.writeFileString(
        path.join(directory, "threads", "portable-thread.json"),
        yield* Schema.encodeEffect(Schema.fromJsonString(PortableConversationDocument))(legacy),
      );
      const scripts = [
        {
          id: "review",
          name: "Review",
          kind: "prompt" as const,
          prompt: "Review changes",
          modelSelection: thread.modelSelection,
          icon: "debug" as const,
          runOnWorktreeCreate: false,
        },
      ];
      yield* fs.writeFileString(
        path.join(directory, "manifest.json"),
        yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
          schemaVersion: 1,
          enabled: true,
          updatedAt: DateTime.formatIso(now),
          scripts,
        }),
      );
      const testConfig = Layer.effect(
        ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          return ServerConfig.of({ ...config, mode: "desktop" });
        }),
      ).pipe(Layer.provide(ServerConfig.layerTest(root, stateDir)));
      yield* Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const eventSink = yield* EventSink.EventSinkV2;
        yield* eventSink.commitProjectCommand({
          commandId: CommandId.make("project"),
          projectId,
          commandType: "project.create",
          acceptedAt: now,
          event: {
            eventId: EventId.make("project"),
            aggregateKind: "project",
            aggregateId: projectId,
            commandId: CommandId.make("project"),
            causationEventId: null,
            correlationId: null,
            metadata: {},
            type: "project.created",
            occurredAt: DateTime.formatIso(now),
            payload: {
              projectId,
              title: "Project",
              workspaceRoot: root,
              defaultModelSelection: null,
              scripts: [],
              createdAt: DateTime.formatIso(now),
              updatedAt: DateTime.formatIso(now),
            },
          },
        });
        const orchestrator = Layer.mock(OrchestratorV2)({
          getShellSnapshot: (options) => projections.getShellSnapshot(options).pipe(Effect.orDie),
          getThreadShell: (id) => projections.getThreadShell(id).pipe(Effect.orDie),
          getThreadProjection: (id) => projections.getThreadProjection(id).pipe(Effect.orDie),
        });
        yield* Effect.gen(function* () {
          const storage = yield* ProjectConversationStorage;
          const enabled = yield* storage.setEnabled({ projectId, enabled: true });
          assert.equal(enabled.exportedThreadCount, 1);
          const restored = yield* projections.getThreadProjection(thread.id);
          assert.equal(restored.messages[0]?.text, "Keep this answer");
          assert.deepStrictEqual(restored.messages[0]?.modelSelection, thread.modelSelection);
          const exported = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(PortableConversationDocument),
          )(yield* fs.readFileString(path.join(directory, "threads", "portable-thread.json")));
          assert.equal(exported.schemaVersion, 2);
          if (exported.schemaVersion === 2)
            assert.equal(exported.messages[0]?.text, "Keep this answer");
          const manifest = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Struct({ scripts: Schema.Array(ProjectScript) })),
          )(yield* fs.readFileString(path.join(directory, "manifest.json")));
          assert.deepStrictEqual(manifest.scripts, scripts);
          assert.isFalse((yield* storage.setEnabled({ projectId, enabled: false })).enabled);
          assert.isTrue(yield* fs.exists(path.join(directory, "threads", "portable-thread.json")));
        }).pipe(
          Effect.provide(
            ProjectConversationStorageLive.pipe(
              Layer.provide(orchestrator),
              Layer.provide(settingsLayerTest()),
              Layer.provide(testConfig),
              Layer.provide(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) })),
            ),
          ),
        );
      }).pipe(Effect.provide(sink));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
