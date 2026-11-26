import {
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  WS_METHODS,
  type DiscoveredLocalServer,
  type DiscoveredLocalServerList,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadShell,
  type ScheduledTaskListResult,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  threadHtmlRenderAttachmentIds,
} from "../attachmentStore.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../serverSettings.ts";

type ThreadLookup<E> = (
  id: ThreadId,
) => Effect.Effect<Pick<OrchestrationV2ThreadShell, "projectId" | "deletedAt"> | null, E>;

export function sharedProjectIds(settings: Pick<ServerSettings, "connectSharedProjects">) {
  return new Set(Object.keys(settings.connectSharedProjects).map((id) => ProjectId.make(id)));
}

const projectSettingsKeys = [
  "connectSharedProjects",
  "projectSettingsOverrides",
  "projectAgentBrowserAccessOverrides",
  "projectAutoPullOverrides",
  "projectScriptOverrides",
] as const;

export function filterProjectSettings(settings: ServerSettings, projects: ReadonlySet<ProjectId>) {
  const keep = <V>(entries: Readonly<Record<string, V>>) =>
    Object.fromEntries(Object.entries(entries).filter(([id]) => projects.has(ProjectId.make(id))));
  return {
    ...settings,
    connectSharedProjects: keep(settings.connectSharedProjects),
    projectSettingsOverrides: keep(settings.projectSettingsOverrides),
    projectAgentBrowserAccessOverrides: keep(settings.projectAgentBrowserAccessOverrides),
    projectAutoPullOverrides: keep(settings.projectAutoPullOverrides),
    projectScriptOverrides: keep(settings.projectScriptOverrides),
  };
}

export function filterShellSnapshot<T extends OrchestrationV2ShellSnapshot>(
  snapshot: T,
  projectIds: ReadonlySet<ProjectId>,
): T {
  return {
    ...snapshot,
    projects: snapshot.projects.filter((project) => projectIds.has(project.id)),
    threads: snapshot.threads.filter((thread) => projectIds.has(thread.projectId)),
    archivedThreads: snapshot.archivedThreads.filter((thread) => projectIds.has(thread.projectId)),
    ...(snapshot.olderSettled === undefined
      ? {}
      : {
          olderSettled: {
            ...snapshot.olderSettled,
            counts: snapshot.olderSettled.counts.filter(({ projectId }) =>
              projectIds.has(projectId),
            ),
          },
        }),
  };
}

export function filterDiscoveredLocalServerStream<E, R>(
  stream: Stream.Stream<DiscoveredLocalServerList, E, R>,
  canReadAgent: (threadId: ThreadId) => Effect.Effect<boolean>,
  canReadTerminal: (
    terminal: NonNullable<DiscoveredLocalServer["terminal"]>,
  ) => Effect.Effect<boolean>,
) {
  return stream.pipe(
    Stream.mapEffect(
      Effect.fnUntraced(function* (snapshot) {
        const servers = yield* Effect.forEach(
          snapshot.servers,
          Effect.fnUntraced(function* (server) {
            const agent =
              server.agent != null && (yield* canReadAgent(server.agent.threadId))
                ? server.agent
                : null;
            const terminal =
              server.terminal !== null && (yield* canReadTerminal(server.terminal))
                ? server.terminal
                : null;
            if (
              (server.agent != null || server.terminal !== null) &&
              agent === null &&
              terminal === null
            )
              return null;
            return { ...server, terminal, ...(server.agent === undefined ? {} : { agent }) };
          }),
        );
        return { ...snapshot, servers: servers.filter((server) => server !== null) };
      }),
    ),
  );
}

export function filterShellStream<E, R>(
  stream: Stream.Stream<OrchestrationV2ShellStreamItem, E, R>,
  projectIds: ReadonlySet<ProjectId>,
) {
  return Stream.suspend(() => {
    const shownThreads = new Map<ThreadId, "active" | "archive">();
    return stream.pipe(
      Stream.flatMap((item): Stream.Stream<OrchestrationV2ShellStreamItem> => {
        switch (item.kind) {
          case "snapshot":
            for (const thread of item.snapshot.threads) shownThreads.set(thread.id, "active");
            for (const thread of item.snapshot.archivedThreads)
              shownThreads.set(thread.id, "archive");
            return Stream.make(item);
          case "project.updated":
            return projectIds.has(item.project.id) ? Stream.make(item) : Stream.empty;
          case "project.removed":
            return projectIds.has(item.projectId) ? Stream.make(item) : Stream.empty;
          case "thread.updated": {
            if (projectIds.has(item.thread.projectId)) {
              shownThreads.set(item.thread.id, item.location);
              return Stream.make(item);
            }
            const location = shownThreads.get(item.thread.id);
            if (location === undefined) return Stream.empty;
            shownThreads.delete(item.thread.id);
            return Stream.make({
              kind: "thread.removed" as const,
              threadId: item.thread.id,
              location,
              sequence: item.sequence,
            });
          }
          case "thread.removed":
            if (shownThreads.get(item.threadId) !== item.location) return Stream.empty;
            shownThreads.delete(item.threadId);
            return Stream.make(item);
          default:
            return Stream.make(item);
        }
      }),
    );
  });
}

export function threadMovedOutsideProjects(
  event: OrchestrationV2DomainEvent,
  projects: ReadonlySet<ProjectId>,
) {
  return event.type === "thread.metadata-updated" && !projects.has(event.payload.projectId);
}

export function waitForThreadAccessLoss<E>(
  events: Stream.Stream<OrchestrationV2DomainEvent, E>,
  projects: ReadonlySet<ProjectId>,
  seen: ReadonlySet<ThreadId>,
) {
  return events.pipe(
    Stream.filter(
      (event) => seen.has(event.threadId) && threadMovedOutsideProjects(event, projects),
    ),
    Stream.runHead,
    Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: () => Effect.void })),
    Effect.ignore,
  );
}

export const watchThreadAccess = Effect.fn("ConnectProjectAccess.watchThreadAccess")(function* (
  threadId: ThreadId,
) {
  const events = yield* EventSinkV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* Settings.ServerSettingsService;
  const changes = yield* settings.subscribeChanges;
  const cursor = yield* events.latestSequence({ threadId }).pipe(Effect.orElseSucceed(() => null));
  if (cursor === null) return null;
  const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  if (shell === null || shell.deletedAt !== null) return null;
  const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
  if (current?.connectSharedProjects[shell.projectId] !== true) return null;
  return {
    revoked: Effect.raceFirst(
      changes.pipe(
        Stream.filter((next) => next.connectSharedProjects[shell.projectId] !== true),
        Stream.runHead,
        Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: () => Effect.void })),
      ),
      waitForThreadAccessLoss(
        events
          .stream({
            threadId,
            afterSequence: cursor,
            eventType: "thread.metadata-updated",
            bounded: true,
          })
          .pipe(Stream.map(({ event }) => event)),
        new Set([shell.projectId]),
        new Set([threadId]),
      ),
    ),
  };
});

export const canReadThread = Effect.fn("ConnectProjectAccess.canReadThread")(function* <E>(
  getThread: ThreadLookup<E>,
  projectIds: ReadonlySet<ProjectId>,
  threadId: ThreadId,
  allowMissing = false,
) {
  const thread = yield* getThread(threadId).pipe(Effect.orElseSucceed(() => undefined));
  return thread === undefined
    ? false
    : thread === null
      ? allowMissing
      : thread.deletedAt === null && projectIds.has(thread.projectId);
});

const decodeAttachmentToolItem = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ toolName: Schema.optional(Schema.String), output: Schema.Unknown }),
  ),
);

export const canReadAttachment = Effect.fn("ConnectProjectAccess.canReadAttachment")(function* (
  sql: SqlClient.SqlClient,
  projects: ReadonlySet<ProjectId>,
  attachmentId: string,
) {
  if (parseThreadSegmentFromAttachmentId(attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT)
    return true;
  if (projects.size === 0) return false;
  const allowed = sql.in([...projects]);
  const withinHistory = (runId: string) => sql`
    (history.through IS NULL OR COALESCE((
      SELECT run.ordinal FROM orchestration_v2_projection_runs AS run
      WHERE run.run_id = ${sql.literal(runId)}
    ), -1) <= history.through)
  `;
  const matches = yield* sql<{ readonly thread_id: ThreadId; readonly render: string | null }>`
    WITH RECURSIVE history(thread_id, through) AS (
      SELECT thread_id, NULL
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL AND project_id IN ${allowed}
      UNION
      SELECT transfer.source_thread_id, run.ordinal
      FROM history
      JOIN orchestration_v2_projection_threads AS fork USING (thread_id)
      JOIN orchestration_v2_projection_context_transfers AS transfer
        ON transfer.target_thread_id = fork.thread_id AND transfer.type = 'fork'
      JOIN orchestration_v2_projection_runs AS run
        ON run.run_id = json_extract(fork.payload_json, '$.forkedFrom.runId')
        AND run.thread_id = transfer.source_thread_id
      WHERE json_extract(fork.payload_json, '$.forkedFrom.type') = 'run'
        AND json_extract(fork.payload_json, '$.forkedFrom.threadId') = transfer.source_thread_id
        AND json_extract(fork.payload_json, '$.lineage.sideChat') IS NOT 1
    ), visible_history AS (
      SELECT history.thread_id, history.through
      FROM history
      JOIN orchestration_v2_projection_threads AS source USING (thread_id)
      WHERE history.through IS NULL OR source.deleted_at IS NOT NULL
    )
    SELECT message.thread_id, NULL AS render
    FROM visible_history AS history
    CROSS JOIN orchestration_v2_projection_messages AS message ON message.thread_id = history.thread_id
    CROSS JOIN json_each(message.payload_json, '$.attachments') AS attachment
    WHERE json_extract(attachment.value, '$.id') = ${attachmentId}
      AND ${withinHistory("message.run_id")}
    UNION ALL
    SELECT thread.thread_id, NULL AS render
    FROM orchestration_v2_projection_threads AS thread,
      json_each(thread.payload_json, '$.guestShare.messages') AS message,
      json_each(message.value, '$.attachments') AS attachment
    WHERE thread.deleted_at IS NULL AND thread.project_id IN ${allowed}
      AND json_extract(message.value, '$.status') = 'pending'
      AND json_extract(attachment.value, '$.id') = ${attachmentId}
    UNION ALL
    SELECT item.thread_id, CASE WHEN item.type = 'dynamic_tool' THEN item.payload_json ELSE NULL END AS render
    FROM visible_history AS history
    CROSS JOIN orchestration_v2_projection_turn_items AS item ON item.thread_id = history.thread_id
    WHERE ${withinHistory("item.run_id")}
      AND ((item.type = 'dynamic_tool' AND instr(item.payload_json, ${attachmentId}) > 0)
        OR (item.type = 'user_input_request' AND EXISTS (
          SELECT 1 FROM json_each(item.payload_json, '$.questionAnswer.attachmentsByQuestionId') AS question,
            json_each(question.value) AS attachment
          WHERE json_extract(attachment.value, '$.id') = ${attachmentId}
        )))
  `;
  return matches.some((row) => {
    if (row.render === null) return true;
    const item = decodeAttachmentToolItem(row.render);
    return (
      Option.isSome(item) &&
      threadHtmlRenderAttachmentIds(row.thread_id, [
        { ...item.value, toolName: item.value.toolName },
      ]).includes(attachmentId)
    );
  });
});

const privateEnvironmentMethods = new Set<string>([
  WS_METHODS.serverListAcpRegistrySessions,
  WS_METHODS.serverImportAcpRegistrySession,
  WS_METHODS.serverDeleteAcpRegistrySession,
  WS_METHODS.peerLinksPairClient,
  WS_METHODS.peerLinksPairLink,
  WS_METHODS.subscribeProjectClones,
  WS_METHODS.projectCloneCancel,
  WS_METHODS.projectCloneRetry,
  WS_METHODS.projectsEnsureScratch,
  WS_METHODS.projectsCreateNew,
  WS_METHODS.projectsCreateFromThread,
  WS_METHODS.projectCloneStart,
  WS_METHODS.serverGetStorageCleanupReport,
  WS_METHODS.serverRunStorageCleanup,
  WS_METHODS.serverGetTraceDiagnostics,
]);

const scheduledTaskMethods = new Set<string>([
  WS_METHODS.scheduledTasksUpsert,
  WS_METHODS.scheduledTasksSetEnabled,
  WS_METHODS.scheduledTasksDelete,
  WS_METHODS.scheduledTasksRunNow,
  WS_METHODS.scheduledTasksRotateWebhookToken,
  WS_METHODS.scheduledTasksListWebhookDeliveries,
  WS_METHODS.scheduledTasksGetWebhookDelivery,
]);
const discussionMethods = new Set<string>([
  WS_METHODS.pullRequestsThreadComments,
  WS_METHODS.pullRequestsReplyToThread,
  WS_METHODS.pullRequestsSetThreadResolution,
]);
const terminalMethods = new Set<string>([
  WS_METHODS.terminalOpen,
  WS_METHODS.terminalAttach,
  WS_METHODS.terminalObserve,
  WS_METHODS.terminalWrite,
  WS_METHODS.terminalResize,
  WS_METHODS.terminalClear,
  WS_METHODS.terminalClose,
]);
function draftTerminalLaunchRoot(method: string, input: Readonly<Record<string, unknown>>) {
  if (method !== WS_METHODS.terminalOpen && method !== WS_METHODS.terminalAttach) return undefined;
  const env = input.env as Readonly<Record<string, unknown>> | undefined;
  return typeof env?.T3CODE_PROJECT_ROOT === "string"
    ? env.T3CODE_PROJECT_ROOT
    : typeof input.cwd === "string"
      ? input.cwd
      : undefined;
}

const projectKeys = new Set(["projectId", "projectIds", "targetProjectId", "sourceProjectId"]);
const threadKeys = new Set([
  "threadId",
  "threadIds",
  "parentThreadId",
  "sourceThreadId",
  "targetThreadId",
  "childThreadId",
  "senderThreadId",
  "anchorThreadId",
]);

export const projectAccessDenied = () =>
  new EnvironmentAuthorizationError({
    message: "This project is unavailable through T3 Connect.",
    requiredScope: AuthOrchestrationReadScope,
  });

export const authorizeRpc = Effect.fn("ConnectProjectAccess.authorizeRpc")(function* <E, TaskError>(
  method: string,
  payload: unknown,
  projectIds: ReadonlySet<ProjectId>,
  getThread: ThreadLookup<E>,
  listTasks: () => Effect.Effect<ScheduledTaskListResult, TaskError>,
  context?: {
    readonly onThreadAccess: (threadId: ThreadId) => void;
    readonly draftTerminalProject: (
      threadId: ThreadId,
      terminalId: string,
      launchRoot?: string,
    ) => Effect.Effect<ProjectId | undefined>;
    readonly canReuseAttachment?: (attachmentId: string) => Effect.Effect<boolean>;
  },
) {
  if (privateEnvironmentMethods.has(method)) return yield* projectAccessDenied();

  const input = (payload ?? {}) as Readonly<Record<string, unknown>>;
  const knownProjects = new Set<ProjectId>();
  const knownThreads = new Map<ThreadId, boolean>();
  const skipLists =
    method === ORCHESTRATION_V2_WS_METHODS.getThreadTitles ||
    method === ORCHESTRATION_V2_WS_METHODS.getThreadLinkMetadata;
  const newThread =
    method === ORCHESTRATION_V2_WS_METHODS.launchThread ||
    (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand && input.type === "thread.create");
  const fork =
    method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand && input.type === "thread.fork";
  if (scheduledTaskMethods.has(method) && typeof input.id === "string") {
    const id = ScheduledTaskId.make(input.id);
    const list = yield* listTasks().pipe(Effect.orElseSucceed(() => null));
    const current = list?.tasks.find((task) => task.id === id);
    if (list === null || (current === undefined && method !== WS_METHODS.scheduledTasksUpsert))
      return yield* projectAccessDenied();
    if (current !== undefined) knownProjects.add(current.projectId);
  }
  if (
    method === WS_METHODS.serverUpdateSettings &&
    typeof input.patch === "object" &&
    input.patch !== null
  ) {
    const patch = input.patch as Readonly<Record<string, unknown>>;
    for (const key of projectSettingsKeys) {
      const entries = patch[key];
      if (typeof entries === "object" && entries !== null) {
        for (const id of Object.keys(entries)) knownProjects.add(ProjectId.make(id));
      }
    }
  }

  const collect = (value: unknown, depth = 0) => {
    if (typeof value !== "object" || value === null || depth > 8) return;
    for (const [key, entry] of Object.entries(value)) {
      if (projectKeys.has(key)) {
        for (const id of Array.isArray(entry) ? entry : [entry]) {
          if (typeof id === "string") knownProjects.add(ProjectId.make(id));
        }
      } else if (threadKeys.has(key)) {
        if (key === "threadIds" && skipLists) continue;
        if (depth === 0 && key === "threadId" && discussionMethods.has(method)) continue;
        for (const id of Array.isArray(entry) ? entry : [entry]) {
          if (typeof id === "string") {
            const threadId = ThreadId.make(id);
            const allowMissing =
              depth === 0 &&
              ((newThread && key === "threadId") || (fork && key === "targetThreadId"));
            knownThreads.set(threadId, allowMissing && knownThreads.get(threadId) !== false);
          }
        }
      } else if (key !== "attachments" && key !== "payload") {
        collect(entry, depth + 1);
      }
    }
  };
  collect(payload);
  if ([...knownProjects].some((projectId) => !projectIds.has(projectId)))
    return yield* projectAccessDenied();
  for (const [threadId, allowMissing] of knownThreads) {
    // The socket must see a move while this lookup is in flight.
    context?.onThreadAccess(threadId);
    const thread = yield* getThread(threadId).pipe(Effect.orElseSucceed(() => undefined));
    if (
      thread === null &&
      terminalMethods.has(method) &&
      typeof input.terminalId === "string" &&
      context !== undefined
    ) {
      const project = yield* context.draftTerminalProject(
        threadId,
        input.terminalId,
        draftTerminalLaunchRoot(method, input),
      );
      if (project === undefined || !projectIds.has(project)) return yield* projectAccessDenied();
    } else if (
      thread === undefined ||
      (thread === null
        ? !allowMissing
        : thread.deletedAt !== null || !projectIds.has(thread.projectId))
    ) {
      return yield* projectAccessDenied();
    }
  }
  if (context?.canReuseAttachment !== undefined) {
    const attachments =
      method === ORCHESTRATION_V2_WS_METHODS.launchThread
        ? (input.initialMessage as { attachments?: ReadonlyArray<{ id: string }> } | undefined)
            ?.attachments
        : method !== ORCHESTRATION_V2_WS_METHODS.dispatchCommand
          ? undefined
          : input.type === "runtime-request.respond"
            ? Object.values(
                (input.attachmentsByQuestionId as Record<string, ReadonlyArray<{ id: string }>>) ??
                  {},
              ).flat()
            : (input.attachments as ReadonlyArray<{ id: string }> | undefined);
    for (const id of new Set(attachments?.map((attachment) => attachment.id))) {
      if (!(yield* context.canReuseAttachment(id))) return yield* projectAccessDenied();
    }
  }
});
