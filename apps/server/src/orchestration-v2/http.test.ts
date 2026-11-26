import {
  AuthSessionId,
  ChatAttachmentId,
  type AuthEnvironmentScope,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2AppThread,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  OrchestrationV2ThreadTranscript,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import { threadTranscriptHeader } from "@t3tools/shared/threadTranscript";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Etag from "effect/http/Etag";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CLOUD_CONNECT_SUBJECT } from "../auth/EnvironmentAuth.ts";
import { createAttachmentId, createPendingAttachmentId } from "../attachmentStore.ts";
import * as ConnectProjectAccess from "../cloud/ConnectProjectAccess.ts";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import { ProjectEnrichmentService } from "../project/ProjectEnrichmentService.ts";
import * as OrchestrationHttp from "./http.ts";
import { EventSinkV2 } from "./EventSink.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { encodeThreadHistoryCursor } from "./threadHistoryPaging.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

class TranscriptTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.orchestration,
) {}
const decodeTranscript = Schema.decodeUnknownEffect(
  Schema.toCodecJson(OrchestrationV2ThreadTranscript),
);

const now = DateTime.makeUnsafe("2026-09-29T00:00:00.000Z");
const environmentId = EnvironmentId.make("source-بيئة");
const output = "Full tool output. ".repeat(4_000);
const thread = Schema.decodeSync(OrchestrationV2AppThread)({
  id: "source-thread",
  projectId: "source-project",
  title: "Source 界\nconversation",
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: "source-thread", parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
});
const items = Schema.decodeUnknownSync(Schema.Array(OrchestrationV2TurnItem))(
  Array.from({ length: 200 }, (_, position) => ({
    id: `item-${position}`,
    threadId: "source-thread",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: position,
    type: "command_execution",
    status: "completed",
    title: "Read notes",
    input: "cat notes.md",
    output: position === 0 ? output : "Done",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  })),
);

const rolledBackRun = Schema.decodeSync(OrchestrationV2Run)({
  id: "run:rolled-back",
  threadId: "source-thread",
  ordinal: 1,
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  providerThreadId: null,
  userMessageId: "message:rolled-back",
  rootNodeId: null,
  activeAttemptId: null,
  status: "rolled_back",
  requestedAt: now,
  startedAt: now,
  completedAt: now,
  checkpointId: null,
  contextHandoffId: null,
});

// Serves the orchestration HTTP routes over real stores; `allowed` gates the read scope.
const serveOrchestrationHttp = (
  allowed: () => boolean,
  subject = "test",
  onThreadShellRead?: (sink: EventSinkV2["Service"]) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const runtime = ProviderReplayHarness.layerWithRegistry(
      { name: "thread-transcript" },
      ProviderAdapterRegistry.layerFromAdapters([]),
      { runEffectWorker: false },
    );
    const settings = ServerSettings.layerTest({});
    const services = yield* Layer.build(
      Layer.mergeAll(
        runtime,
        settings,
        ThreadManagementService.layer.pipe(
          Layer.provide(Layer.mergeAll(runtime, CommandReceiptStore.layer, settings)),
        ),
        OrchestrationEventStore.layer,
        ProjectStore.layer,
      ).pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
    );
    const eventSink = Context.get(services, EventSinkV2);
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("create-source"),
          type: "thread.created",
          threadId: thread.id,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
    const threads = Context.get(services, ThreadManagementService.ThreadManagementService);
    const routeServices =
      onThreadShellRead === undefined
        ? services
        : Context.add(services, ThreadManagementService.ThreadManagementService, {
            ...threads,
            getThreadShell: (id) =>
              threads.getThreadShell(id).pipe(Effect.tap(() => onThreadShellRead(eventSink))),
          });
    const routes = HttpApiBuilder.layer(TranscriptTestApi).pipe(
      Layer.provide(OrchestrationHttp.layer),
      Layer.provide(
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(environmentId),
        }),
      ),
      Layer.provide(
        Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
          Effect.suspend(() =>
            effect.pipe(
              Effect.provideService(EnvironmentAuthenticatedPrincipal, {
                sessionId: AuthSessionId.make("test-session"),
                subject,
                method: "bearer-access-token",
                scopes: new Set<AuthEnvironmentScope>(allowed() ? ["orchestration:read"] : []),
              }),
            ),
          ),
        ),
      ),
      Layer.provide(Layer.succeedContext(routeServices)),
      Layer.provide(Layer.mock(ProjectEnrichmentService)({})),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(Etag.layerWeak),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return { services, eventSink, handler };
  });

it.effect("exposes a Connect transcript only while its project is shared", () =>
  Effect.gen(function* () {
    const { services, handler } = yield* serveOrchestrationHttp(() => true, CLOUD_CONNECT_SUBJECT);
    const settings = Context.get(services, ServerSettings.ServerSettingsService);
    const read = () =>
      Effect.promise(() =>
        handler(
          new Request(`http://localhost/api/orchestration/threads/${thread.id}/transcript`, {
            headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
          }),
        ),
      );
    expect((yield* read()).status).toBe(404);
    yield* settings.updateSettings({ connectSharedProjects: { [thread.projectId]: true } });
    expect((yield* read()).status).toBe(200);
    yield* settings.updateSettings({ connectSharedProjects: { [thread.projectId]: null } });
    expect((yield* read()).status).toBe(404);
  }),
);

it.effect("revokes an authorized media stream after a move before its watcher starts", () =>
  Effect.gen(function* () {
    const { services, eventSink } = yield* serveOrchestrationHttp(() => true);
    yield* Context.get(services, ServerSettings.ServerSettingsService).updateSettings({
      connectSharedProjects: { [thread.projectId]: true },
    });
    const access = yield* ConnectProjectAccess.watchThreadAccess(thread.id).pipe(
      Effect.provide(services),
    );
    expect(access).not.toBeNull();
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("move-before-media-start"),
          type: "thread.metadata-updated",
          threadId: thread.id,
          occurredAt: now,
          payload: { ...thread, projectId: ProjectId.make("private") },
        },
      ],
    });
    yield* access!.revoked;
  }),
);

it.effect.each(["", "/bounded", "/transcript", "/history"] as const)(
  "checks the project in the HTTP %s snapshot after a concurrent move",
  (path) =>
    Effect.gen(function* () {
      const { services, handler } = yield* serveOrchestrationHttp(
        () => true,
        CLOUD_CONNECT_SUBJECT,
        (sink) =>
          sink
            .write({
              events: [
                {
                  id: EventId.make("move-before-http-snapshot"),
                  type: "thread.metadata-updated",
                  threadId: thread.id,
                  occurredAt: now,
                  payload: { ...thread, projectId: ProjectId.make("private") },
                },
              ],
            })
            .pipe(Effect.asVoid, Effect.orDie),
      );
      yield* Context.get(services, ServerSettings.ServerSettingsService).updateSettings({
        connectSharedProjects: { [thread.projectId]: true },
      });
      const url = new URL(`http://localhost/api/orchestration/threads/${thread.id}${path}`);
      if (path === "/history") {
        url.searchParams.set(
          "cursor",
          encodeThreadHistoryCursor({
            snapshotSequence: 1,
            sourceThreadId: thread.id,
            sourceItemId: "item-99",
            position: 0,
          }),
        );
      }
      const response = yield* Effect.promise(() =>
        handler(
          new Request(url, {
            headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
          }),
        ),
      );
      expect(response.status).toBe(404);
    }),
);

it.effect("authorizes saved asset URLs only for attachments belonging to a shared thread", () =>
  Effect.gen(function* () {
    const { services, eventSink } = yield* serveOrchestrationHttp(() => true);
    const attachmentId = ChatAttachmentId.make(createAttachmentId(thread.id)!);
    const renderId = createAttachmentId(thread.id, "html")!;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("attach-image"),
          type: "message.updated",
          threadId: thread.id,
          occurredAt: now,
          payload: {
            id: MessageId.make("message:image"),
            threadId: thread.id,
            runId: null,
            nodeId: null,
            role: "user",
            text: "Image",
            createdBy: "user",
            creationSource: "web",
            attachments: [
              {
                type: "image",
                id: attachmentId,
                name: "img.png",
                mimeType: "image/png",
                sizeBytes: 8,
              },
            ],
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: EventId.make("attach-render"),
          type: "turn-item.updated",
          threadId: thread.id,
          occurredAt: now,
          payload: {
            ...items.find((item) => item.type === "command_execution")!,
            type: "dynamic_tool",
            toolName: "mcp__t3-code__html_render",
            input: null,
            output: [
              {
                type: "text",
                text: JSON.stringify({
                  htmlRender: { attachmentId: renderId, title: "render", height: 300 },
                }),
              },
            ],
          },
        },
      ],
    });
    const sql = Context.get(services, SqlClient.SqlClient);
    const shared = new Set([thread.projectId]);
    for (const id of [attachmentId, renderId]) {
      expect(yield* ConnectProjectAccess.canReadAttachment(sql, shared, id)).toBe(true);
      expect(yield* ConnectProjectAccess.canReadAttachment(sql, new Set(), id)).toBe(false);
    }
    expect(
      yield* ConnectProjectAccess.canReadAttachment(sql, shared, createAttachmentId(thread.id)!),
    ).toBe(false);
    expect(
      yield* ConnectProjectAccess.canReadAttachment(sql, new Set(), createPendingAttachmentId()),
    ).toBe(true);
    const authorize = (method: string, payload: unknown) =>
      ConnectProjectAccess.authorizeRpc(
        method,
        payload,
        shared,
        () => Effect.succeed({ projectId: thread.projectId, deletedAt: null }),
        () => Effect.succeed({ tasks: [] }),
        {
          onThreadAccess: () => {},
          draftTerminalProject: () => Effect.undefined,
          canReuseAttachment: (id) =>
            ConnectProjectAccess.canReadAttachment(sql, shared, id).pipe(
              Effect.orElseSucceed(() => false),
            ),
        },
      );
    const privateReference = [{ id: createAttachmentId("private-thread")! }];
    for (const payload of [
      { type: "message.dispatch", attachments: privateReference },
      { type: "queued-run.edit", attachments: privateReference },
      { type: "runtime-request.respond", attachmentsByQuestionId: { question: privateReference } },
    ]) {
      expect(
        yield* authorize(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
          ...payload,
          threadId: thread.id,
        }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
    }
    expect(
      yield* authorize(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        projectId: thread.projectId,
        initialMessage: { attachments: privateReference },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
    yield* authorize(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
      type: "queued-run.edit",
      threadId: thread.id,
      attachments: [{ id: attachmentId }],
    });
  }),
);

it.effect("exports full history with size, scope, and missing-thread checks", () =>
  Effect.gen(function* () {
    let allowed = true;
    const { services, eventSink, handler } = yield* serveOrchestrationHttp(() => allowed);
    const read = (threadId: ThreadId) =>
      Effect.promise(() =>
        handler(
          new Request(`http://localhost/api/orchestration/threads/${threadId}/transcript`, {
            headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
          }),
        ),
      );

    const readTranscriptError = Context.get(
      services,
      ThreadManagementService.ThreadManagementService,
    )
      .getThreadTranscript(thread.id)
      .pipe(
        Effect.provideService(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(environmentId),
        }),
        Effect.flip,
      );

    const emptyResponse = yield* read(thread.id);
    expect(emptyResponse.status).toBe(200);
    expect(
      (yield* decodeTranscript(yield* Effect.promise(() => emptyResponse.json()))).items,
    ).toEqual([]);
    yield* eventSink.write({
      events: items.map((item) => ({
        id: EventId.make(`create-${item.id}`),
        type: "turn-item.updated" as const,
        threadId: thread.id,
        occurredAt: now,
        payload: item,
      })),
    });

    const response = yield* read(thread.id);
    expect(response.status).toBe(200);
    const transcript = yield* decodeTranscript(yield* Effect.promise(() => response.json()));
    expect(transcript.items).toHaveLength(200);
    expect(transcript.items[0]?.item).toMatchObject({ output });
    expect(transcript.items[0]?.visibility).toBe("local");
    expect(transcript.items[199]?.position).toBe(199);

    const emptyOutputRows = transcript.items.map((row, position) =>
      position === 0 ? { ...row, item: { ...row.item, output: "" } } : row,
    );
    const header = threadTranscriptHeader(environmentId, transcript);
    const baseSize =
      Buffer.byteLength(header, "utf8") +
      emptyOutputRows.reduce(
        (size, row) => size + Buffer.byteLength(`${JSON.stringify(row)}\n`, "utf8"),
        0,
      );
    const boundaryOutput = "界" + "x".repeat(PROVIDER_SEND_TURN_MAX_FILE_BYTES - baseSize - 3);
    for (const [suffix, expectedStatus] of [
      ["", 200],
      ["x", 400],
    ] as const) {
      yield* eventSink.write({
        events: [
          {
            id: EventId.make(`boundary-${expectedStatus}`),
            type: "turn-item.updated",
            threadId: thread.id,
            occurredAt: now,
            payload: {
              ...items.find((item) => item.type === "command_execution")!,
              output: boundaryOutput + suffix,
            },
          },
        ],
      });
      const response = yield* read(thread.id);
      expect(response.status).toBe(expectedStatus);
      if (expectedStatus === 200) continue;
      expect(yield* readTranscriptError).toBeInstanceOf(
        ThreadManagementService.ThreadTranscriptTooLargeError,
      );
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        _tag: "EnvironmentRequestInvalidError",
        reason: "thread_transcript_too_large",
      });
    }

    const sql = Context.get(services, SqlClient.SqlClient);
    const commandItemId = items.find((item) => item.type === "command_execution")!.id;
    const setCommandPayload = (payload: Statement.Fragment) => sql`
      UPDATE orchestration_v2_projection_turn_items SET payload_json = ${payload}
      WHERE turn_item_id = ${commandItemId}
    `;
    const fill = (bytes: number) => sql`printf('%.*c', ${bytes}, 'x')`;
    // Stored bytes the export drops do not count, and neither does a row SQLite cannot parse:
    // only what the export keeps can reject it.
    yield* setCommandPayload(sql`json_set(
      payload_json, '$.output', 'x',
      '$.droppedLegacyField', ${fill(PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1)}
    )`);
    expect((yield* read(thread.id)).status).toBe(200);
    const deepField = sql`'"droppedDeepField":' || printf('%.*c', 1001, '[') || printf('%.*c', 1001, ']') || ','`;
    yield* setCommandPayload(
      sql`replace(payload_json, '"droppedLegacyField":', ${deepField} || '"droppedLegacyField":')`,
    );
    expect((yield* read(thread.id)).status).toBe(200);
    // Tool output over the limit rejects the export, here as the content array a dynamic tool
    // stores. Its only read is the size.
    yield* sql`
      UPDATE orchestration_v2_projection_turn_items SET type = 'dynamic_tool'
      WHERE turn_item_id = ${commandItemId}
    `;
    yield* setCommandPayload(sql`json_set(
      replace(payload_json, ${deepField}, ''), '$.type', 'dynamic_tool', '$.toolName', NULL,
      '$.output',
      json_array(json_object('type', 'text', 'text', ${fill(PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1)}))
    )`);
    const reads: Array<string> = [];
    expect(
      yield* readTranscriptError.pipe(
        Effect.provideService(Statement.CurrentTransformer, (statement) => {
          reads.push(statement.compile()[0]);
          return Effect.succeed(statement);
        }),
      ),
    ).toBeInstanceOf(ThreadManagementService.ThreadTranscriptTooLargeError);
    expect(reads).toEqual([expect.stringContaining("octet_length(payload_json)")]);
    expect((yield* read(thread.id)).status).toBe(400);
    // The export leaves a rolled back run out, so its output cannot reject it.
    yield* eventSink.write({
      events: [
        {
          id: EventId.make("create-rolled-back-run"),
          type: "run.created",
          threadId: thread.id,
          occurredAt: now,
          payload: rolledBackRun,
        },
      ],
    });
    yield* sql`
      UPDATE orchestration_v2_projection_turn_items SET run_id = ${rolledBackRun.id}
      WHERE turn_item_id = ${commandItemId}
    `;
    yield* setCommandPayload(sql`json_set(payload_json, '$.runId', ${rolledBackRun.id})`);
    const withoutRolledBackRun = yield* read(thread.id);
    expect(withoutRolledBackRun.status).toBe(200);
    expect(
      (yield* decodeTranscript(yield* Effect.promise(() => withoutRolledBackRun.json()))).items,
    ).toHaveLength(199);

    expect((yield* read(ThreadId.make("missing"))).status).toBe(404);
    allowed = false;
    expect((yield* read(thread.id)).status).toBe(403);
  }),
);

it.effect("leaves older settled threads out of the HTTP shell only when asked", () =>
  Effect.gen(function* () {
    const { eventSink, handler } = yield* serveOrchestrationHttp(() => true);
    yield* eventSink.write({
      events: Array.from({ length: 26 }, (_, index) => {
        const id = ThreadId.make(`settled-${index}`);
        return {
          id: EventId.make(`create-${id}`),
          type: "thread.created" as const,
          threadId: id,
          occurredAt: now,
          payload: {
            ...thread,
            id,
            lineage: { ...thread.lineage, rootThreadId: id },
            settledOverride: "settled" as const,
            settledAt: DateTime.makeUnsafe(Date.UTC(2026, 8, 1 + index)),
          },
        };
      }),
    });
    const shell = (query: string) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://localhost/api/orchestration/shell${query}`, {
            headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
          }),
        );
        return (await response.json()) as {
          readonly snapshotSequence: number;
          readonly projectIdentities?: string;
          readonly threads: ReadonlyArray<{ readonly id: string }>;
          readonly olderSettled?: { readonly counts: ReadonlyArray<unknown> };
        };
      });

    const full = yield* shell("");
    expect(full.threads).toHaveLength(27);
    expect(full.olderSettled).toBeUndefined();
    const cut = yield* shell("?omitOlderSettled=1");
    expect(cut.threads.map((row) => row.id).toSorted()).toEqual(
      [thread.id, ...Array.from({ length: 25 }, (_, index) => `settled-${index + 1}`)].toSorted(),
    );
    expect(cut.olderSettled?.counts).toEqual([{ projectId: thread.projectId, count: 1 }]);

    // A client that holds rows the socket can replay from keeps them; any other cursor reloads.
    expect(full.projectIdentities).toBeTypeOf("string");
    expect(yield* shell(`?resumeFrom=${full.snapshotSequence}`)).toEqual({ resumable: true });
    expect(yield* shell(`?resumeFrom=${full.snapshotSequence - 1}`)).toEqual({ resumable: true });
    for (const cursor of [full.snapshotSequence + 1, "x"]) {
      expect((yield* shell(`?omitOlderSettled=1&resumeFrom=${cursor}`)).threads).toHaveLength(26);
    }
  }),
);
