import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  CommandId,
  PortableConversationDocument,
  PROJECT_CONVERSATION_STORAGE_DIRECTORY,
  PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
  ProjectConversationStorageError,
  EventId,
  TurnItemId,
  type ApplicationStoredEvent,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type OrchestrationProjectShell,
  ProjectScript,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { attachmentRelativePath, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import {
  ProjectConversationStorage,
  type ProjectConversationStorageShape,
} from "./ProjectConversationStorage.ts";

const MANIFEST_FILE_NAME = "manifest.json";
const THREADS_DIRECTORY_NAME = "threads";
const ATTACHMENTS_DIRECTORY_NAME = "attachments";

const Manifest = Schema.Struct({
  schemaVersion: Schema.Literals([1, PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION]),
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
  scripts: Schema.optionalKey(Schema.Array(ProjectScript)),
});
const ManifestJson = Schema.fromJsonString(Manifest);
const PortableConversationJson = Schema.fromJsonString(PortableConversationDocument);
const ProjectScriptsJson = Schema.fromJsonString(Schema.Array(ProjectScript));
const decodeManifest = Schema.decodeUnknownEffect(ManifestJson);
const decodePortableConversation = Schema.decodeUnknownEffect(PortableConversationJson);
const encodeManifest = Schema.encodeEffect(ManifestJson);
const encodePortableConversation = Schema.encodeEffect(PortableConversationJson);
const encodeProjectScripts = Schema.encodeEffect(ProjectScriptsJson);

type PortableProject = Pick<OrchestrationProjectShell, "id" | "workspaceRoot" | "scripts">;

function storageError(message: string): ProjectConversationStorageError {
  return new ProjectConversationStorageError({ message });
}

export function portableThreadSnapshot(
  projectId: ProjectId,
  document: PortableConversationDocument,
) {
  const original = document.thread;
  const thread: OrchestrationV2AppThread = {
    ...original,
    createdBy: "system",
    creationSource: "server",
    projectId,
    providerInstanceId: original.modelSelection.instanceId,
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: original.id },
    forkedFrom: null,
    lastVisitedAt: null,
  };
  const messages: ReadonlyArray<OrchestrationV2ConversationMessage> =
    document.schemaVersion === 2
      ? document.messages.map((message) => ({
          ...message,
          threadId: thread.id,
          runId: null,
          nodeId: null,
          streaming: false,
        }))
      : originalMessages(document).map((message) => ({
          ...message,
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          role: message.role === "reasoning" ? "assistant" : message.role,
          threadId: thread.id,
          runId: null,
          nodeId: null,
          attachments: message.attachments ?? [],
          streaming: false,
        }));
  const turnItems: ReadonlyArray<OrchestrationV2TurnItem> =
    document.schemaVersion === 2
      ? document.turnItems.map((item) => ({
          ...item,
          threadId: thread.id,
          runId: null,
          nodeId: null,
          status: item.status === "running" ? "interrupted" : item.status,
        }))
      : messages.map((message, index): OrchestrationV2TurnItem => {
          const base = {
            id: TurnItemId.make(`portable:${message.id}`),
            threadId: thread.id,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: index + 1,
            status: "completed" as const,
            title: null,
            startedAt: message.createdAt,
            completedAt: message.updatedAt,
            updatedAt: message.updatedAt,
          };
          return message.role === "user"
            ? {
                ...base,
                type: "user_message",
                createdBy: "user",
                creationSource: "server",
                messageId: message.id,
                inputIntent: "turn_start",
                text: message.text,
                context: message.context,
                attachments: message.attachments,
              }
            : {
                ...base,
                type: "assistant_message",
                messageId: message.id,
                text: message.text,
                modelSelection: message.modelSelection,
                streaming: false,
              };
        });
  return { thread, messages, turnItems };
}

function originalMessages(document: Extract<PortableConversationDocument, { schemaVersion: 1 }>) {
  return document.thread.messages;
}

type PortableProjection = Pick<
  OrchestrationV2ThreadProjection,
  "messages" | "runs" | "turnItems" | "visibleTurnItems"
>;

export function portableConversationHistory(
  projection: PortableProjection,
  inheritedSources: ReadonlyArray<PortableProjection>,
) {
  const visibleMessageIds = new Set(
    projection.visibleTurnItems.flatMap(({ item }) =>
      item.type === "user_message" || item.type === "assistant_message" ? [item.messageId] : [],
    ),
  );
  const sourceMessages = [
    ...inheritedSources.flatMap((source) =>
      source.messages.filter((message) => visibleMessageIds.has(message.id)),
    ),
    ...projection.messages,
  ];
  const sourceRuns = [...inheritedSources.flatMap((source) => source.runs), ...projection.runs];
  const messages = [
    ...new Map(sourceMessages.map((message) => [message.id, message])).values(),
  ].map((message) => ({
    ...message,
    streaming: false,
    modelSelection:
      message.modelSelection ?? sourceRuns.find((run) => run.id === message.runId)?.modelSelection,
  }));
  const turnItems =
    projection.visibleTurnItems.length > 0
      ? projection.visibleTurnItems.map(({ item }, ordinal) => ({
          ...item,
          ordinal: ordinal + 1,
          ...(item.type === "assistant_message"
            ? {
                modelSelection:
                  item.modelSelection ??
                  sourceRuns.find((run) => run.id === item.runId)?.modelSelection,
              }
            : {}),
        }))
      : projection.turnItems;
  return { messages, turnItems };
}

export const makeProjectConversationStorage = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestratorV2;
  const projects = yield* ProjectStoreV2;
  const eventSink = yield* EventSinkV2;
  const events = yield* OrchestrationEventStore;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settingsService = yield* ServerSettingsService;
  const importLock = yield* Semaphore.make(1);
  const enabledProjects = yield* Ref.make(new Map<ProjectId, string>());

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const writeAtomically = (input: { readonly filePath: string; readonly contents: string }) =>
    writeFileStringAtomically(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  const storageDirectory = (workspaceRoot: string) =>
    path.join(workspaceRoot, ...PROJECT_CONVERSATION_STORAGE_DIRECTORY.split("/"));
  const manifestPath = (workspaceRoot: string) =>
    path.join(storageDirectory(workspaceRoot), MANIFEST_FILE_NAME);
  const threadsDirectory = (workspaceRoot: string) =>
    path.join(storageDirectory(workspaceRoot), THREADS_DIRECTORY_NAME);
  const attachmentsDirectory = (workspaceRoot: string) =>
    path.join(storageDirectory(workspaceRoot), ATTACHMENTS_DIRECTORY_NAME);
  const threadDocumentPath = (workspaceRoot: string, threadId: ThreadId) =>
    path.join(threadsDirectory(workspaceRoot), `${threadId}.json`);

  const requireDesktop = Effect.fn("ProjectConversationStorage.requireDesktop")(function* () {
    if (config.mode !== "desktop") {
      return yield* storageError(
        "Local project conversation storage is available only in the desktop app.",
      );
    }
  });

  const readManifest = Effect.fn("ProjectConversationStorage.readManifest")(function* (
    workspaceRoot: string,
  ) {
    const filePath = manifestPath(workspaceRoot);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(cause),
      }),
    );
    if (Option.isNone(raw)) return Option.none<Schema.Schema.Type<typeof Manifest>>();
    return Option.some(yield* decodeManifest(raw.value));
  });

  const listExportedThreadFiles = Effect.fn("ProjectConversationStorage.listExportedThreadFiles")(
    function* (workspaceRoot: string) {
      return yield* fileSystem
        .readDirectory(threadsDirectory(workspaceRoot), { recursive: false })
        .pipe(
          Effect.map((entries) => entries.filter((entry) => entry.endsWith(".json")).toSorted()),
          Effect.catchTags({
            PlatformError: (cause) =>
              cause.reason._tag === "NotFound"
                ? Effect.succeed([] as string[])
                : Effect.fail(cause),
          }),
        );
    },
  );

  const resolveProject = Effect.fn("ProjectConversationStorage.resolveProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projects.getShell(projectId);
    if (Option.isNone(project)) {
      return yield* storageError(`Project '${projectId}' was not found.`);
    }
    return project.value;
  });

  const copyAttachments = Effect.fn("ProjectConversationStorage.copyAttachments")(function* (
    workspaceRoot: string,
    messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
    restore: boolean,
  ) {
    yield* fileSystem.makeDirectory(attachmentsDirectory(workspaceRoot), { recursive: true });
    yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* Effect.forEach(
      messages.flatMap((message) => message.attachments),
      (attachment) =>
        Effect.gen(function* () {
          const localPath = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment,
          });
          const relativePath = attachmentRelativePath(attachment);
          if (localPath === null || relativePath === null) return;
          const portablePath = path.join(attachmentsDirectory(workspaceRoot), relativePath);
          const source = restore ? portablePath : localPath;
          const destination = restore ? localPath : portablePath;
          if (!(yield* fileSystem.exists(source))) return;
          yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
          yield* fileSystem.writeFile(destination, yield* fileSystem.readFile(source));
        }),
      { concurrency: 1 },
    );
  });

  const exportThread = Effect.fn("ProjectConversationStorage.exportThread")(function* (
    workspaceRoot: string,
    threadId: ThreadId,
  ) {
    const projection = yield* engine.getThreadProjection(threadId);
    const thread = projection.thread;
    if (thread === null || thread.deletedAt !== null) return;
    const available = yield* providers.getProviders;
    const inheritedSources = yield* Effect.forEach(
      [
        ...new Set(
          projection.visibleTurnItems
            .filter((entry) => entry.visibility === "inherited")
            .map((entry) => entry.sourceThreadId),
        ),
      ],
      (sourceThreadId) => engine.getThreadProjection(sourceThreadId),
      { concurrency: 1 },
    );
    const { messages, turnItems } = portableConversationHistory(projection, inheritedSources);
    const document: PortableConversationDocument = {
      schemaVersion: 2,
      exportedAt: yield* nowIso,
      sourceProvider:
        available.find((entry) => entry.instanceId === thread.modelSelection.instanceId)?.driver ??
        null,
      thread: {
        ...thread,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        historyOrigin: "v1_import",
      },
      messages,
      turnItems,
    };
    yield* copyAttachments(workspaceRoot, messages, false);
    yield* writeAtomically({
      filePath: threadDocumentPath(workspaceRoot, thread.id),
      contents: `${yield* encodePortableConversation(document)}\n`,
    });
  });

  const writeManifest = Effect.fn("ProjectConversationStorage.writeManifest")(function* (
    workspaceRoot: string,
    enabled: boolean,
    scripts: OrchestrationProjectShell["scripts"],
  ) {
    const manifest = {
      schemaVersion: PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
      enabled,
      updatedAt: yield* nowIso,
      scripts,
    } as const;
    yield* writeAtomically({
      filePath: manifestPath(workspaceRoot),
      contents: `${yield* encodeManifest(manifest)}\n`,
    });
  });

  const exportProject = Effect.fn("ProjectConversationStorage.exportProject")(function* (
    project: PortableProject,
  ) {
    const snapshot = yield* engine.getShellSnapshot();
    const projectThreads = [...snapshot.threads, ...snapshot.archivedThreads].filter(
      (thread) => thread.projectId === project.id && thread.deletedAt === null,
    );
    yield* Effect.forEach(
      projectThreads,
      (thread) => exportThread(project.workspaceRoot, thread.id),
      {
        concurrency: 1,
      },
    );
    yield* writeManifest(
      project.workspaceRoot,
      true,
      resolveProjectScripts(yield* settingsService.getSettings, project),
    );
    yield* Ref.update(enabledProjects, (current) =>
      new Map(current).set(project.id, project.workspaceRoot),
    );
    return projectThreads.length;
  });

  const importProjectScripts = Effect.fn("ProjectConversationStorage.importProjectScripts")(
    function* (project: PortableProject) {
      const manifest = yield* readManifest(project.workspaceRoot);
      const scripts = Option.isSome(manifest) ? manifest.value.scripts : undefined;
      if (
        scripts === undefined ||
        (yield* encodeProjectScripts(scripts)) ===
          (yield* encodeProjectScripts(
            resolveProjectScripts(yield* settingsService.getSettings, project),
          ))
      ) {
        return project;
      }
      const settings = yield* settingsService.getSettings;
      yield* settingsService.updateSettings({
        projectSettingsOverrides: {
          ...settings.projectSettingsOverrides,
          [project.id]: {
            ...settings.projectSettingsOverrides[project.id],
            defaultProjectScripts: Array.from(scripts),
          },
        },
      });
      return { ...project, scripts: Array.from(scripts) };
    },
  );

  const importProject = Effect.fn("ProjectConversationStorage.importProject")(function* (
    project: Pick<OrchestrationProjectShell, "id" | "workspaceRoot">,
  ) {
    const files = yield* listExportedThreadFiles(project.workspaceRoot);
    let imported = 0;
    for (const fileName of files) {
      const document = yield* decodePortableConversation(
        yield* fileSystem.readFileString(
          path.join(threadsDirectory(project.workspaceRoot), fileName),
        ),
      );
      const existing = yield* engine.getThreadShell(document.thread.id);
      // Restore newer snapshots only into the same idle project.
      if (
        existing !== null &&
        (existing.projectId !== project.id ||
          DateTime.toEpochMillis(existing.updatedAt) >=
            DateTime.toEpochMillis(document.thread.updatedAt) ||
          ["preparing", "starting", "running", "waiting", "queued"].includes(existing.status))
      )
        continue;
      const snapshot = portableThreadSnapshot(project.id, document);
      const available = yield* providers.getProviders;
      const target =
        available.find(
          (entry) =>
            entry.instanceId === snapshot.thread.modelSelection.instanceId &&
            entry.enabled &&
            entry.availability !== "unavailable",
        ) ??
        available.find(
          (entry) =>
            entry.driver === document.sourceProvider &&
            entry.enabled &&
            entry.availability !== "unavailable",
        );
      const thread = target
        ? {
            ...snapshot.thread,
            providerInstanceId: target.instanceId,
            modelSelection: { ...snapshot.thread.modelSelection, instanceId: target.instanceId },
          }
        : snapshot.thread;
      yield* copyAttachments(project.workspaceRoot, snapshot.messages, true);
      const uuid = yield* crypto.randomUUIDv4();
      const occurredAt = yield* DateTime.now;
      const importedEvents: ReadonlyArray<OrchestrationV2DomainEvent> = [
        {
          id: EventId.make(`portable:${uuid}:thread`),
          type: existing === null ? "thread.created" : "thread.metadata-updated",
          threadId: thread.id,
          providerInstanceId: thread.providerInstanceId,
          occurredAt,
          payload: thread,
        },
        ...snapshot.messages.map((message) => ({
          id: EventId.make(`portable:${uuid}:message:${message.id}`),
          type: "message.updated" as const,
          threadId: thread.id,
          occurredAt,
          payload: message,
        })),
        ...snapshot.turnItems.map((item) => ({
          id: EventId.make(`portable:${uuid}:item:${item.id}`),
          type: "turn-item.updated" as const,
          threadId: thread.id,
          occurredAt,
          payload: item,
        })),
      ];
      yield* eventSink.write({
        commandId: CommandId.make(`portable:${uuid}`),
        events: importedEvents,
      });
      imported += 1;
    }
    return imported;
  });

  const stateForProject = Effect.fn("ProjectConversationStorage.stateForProject")(function* (
    project: Pick<OrchestrationProjectShell, "id" | "workspaceRoot">,
  ) {
    const manifest = yield* readManifest(project.workspaceRoot);
    const files = yield* listExportedThreadFiles(project.workspaceRoot);
    return {
      projectId: project.id,
      enabled: Option.isSome(manifest) && manifest.value.enabled,
      directory: storageDirectory(project.workspaceRoot),
      exportedThreadCount: files.length,
    };
  });

  const wrapStorageError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          storageError(
            `Project conversation storage failed: ${Cause.pretty(cause).split("\n")[0] ?? "unknown error"}`,
          ),
        ),
      ),
    );

  const getState: ProjectConversationStorageShape["getState"] = (projectId) =>
    wrapStorageError(
      Effect.gen(function* () {
        yield* requireDesktop();
        return yield* stateForProject(yield* resolveProject(projectId));
      }),
    );

  const setEnabled: ProjectConversationStorageShape["setEnabled"] = (input) =>
    wrapStorageError(
      Effect.gen(function* () {
        yield* requireDesktop();
        const project = yield* resolveProject(input.projectId);
        if (input.enabled) {
          const importedProject = yield* importProjectScripts(project);
          yield* importLock.withPermits(1)(importProject(importedProject));
          yield* exportProject(importedProject);
        } else {
          yield* writeManifest(
            project.workspaceRoot,
            false,
            resolveProjectScripts(yield* settingsService.getSettings, project),
          );
          yield* Ref.update(enabledProjects, (current) => {
            const next = new Map(current);
            next.delete(project.id);
            return next;
          });
        }
        return yield* stateForProject(project);
      }),
    );

  const scanProject = Effect.fn("ProjectConversationStorage.scanProject")(function* (
    project: PortableProject,
  ) {
    const manifest = yield* readManifest(project.workspaceRoot);
    if (Option.isNone(manifest) || !manifest.value.enabled) return;
    yield* Ref.update(enabledProjects, (current) =>
      new Map(current).set(project.id, project.workspaceRoot),
    );
    const importedProject = yield* importProjectScripts(project);
    yield* importLock.withPermits(1)(importProject(importedProject));
  });

  const handleEvent = Effect.fn("ProjectConversationStorage.handleEvent")(function* (
    event: ApplicationStoredEvent,
  ) {
    if (
      !("event" in event) &&
      (event.type === "project.created" || event.type === "project.meta-updated")
    ) {
      const project = yield* projects.getShell(event.payload.projectId);
      if (Option.isSome(project)) {
        if (
          event.type === "project.meta-updated" &&
          (yield* Ref.get(enabledProjects)).has(project.value.id)
        ) {
          yield* writeManifest(
            project.value.workspaceRoot,
            true,
            resolveProjectScripts(yield* settingsService.getSettings, project.value),
          );
        } else {
          yield* scanProject(project.value);
        }
      }
      return;
    }
    if (!("event" in event) && event.type === "project.deleted") {
      yield* Ref.update(enabledProjects, (current) => {
        const next = new Map(current);
        next.delete(event.payload.projectId);
        return next;
      });
      return;
    }
    if (!("event" in event)) return;
    const domainEvent = event.event;
    if (domainEvent.type === "thread.deleted") {
      const workspaceRoot = (yield* Ref.get(enabledProjects)).get(domainEvent.payload.projectId);
      if (workspaceRoot !== undefined) {
        yield* fileSystem.remove(threadDocumentPath(workspaceRoot, domainEvent.threadId), {
          force: true,
        });
      }
      return;
    }
    const thread = yield* engine.getThreadShell(domainEvent.threadId);
    if (thread === null) return;
    const workspaceRoot = (yield* Ref.get(enabledProjects)).get(thread.projectId);
    if (workspaceRoot === undefined) return;
    if (thread.deletedAt !== null) {
      yield* fileSystem.remove(threadDocumentPath(workspaceRoot, thread.id), { force: true });
      return;
    }
    const shouldExport =
      domainEvent.type.startsWith("thread.") ||
      (domainEvent.type === "message.updated" && !domainEvent.payload.streaming) ||
      (domainEvent.type === "run.updated" &&
        ["completed", "failed", "cancelled"].includes(domainEvent.payload.status));
    if (!shouldExport) return;
    yield* exportThread(workspaceRoot, thread.id);
  });

  const start: ProjectConversationStorageShape["start"] = Effect.fn(
    "ProjectConversationStorage.start",
  )(function* () {
    if (config.mode !== "desktop") return;
    const afterSequence = yield* events.latestApplicationSequence.pipe(Effect.orDie);
    const snapshot = yield* engine
      .getShellSnapshot()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to initialize project conversation storage", { cause }).pipe(
            Effect.as(null),
          ),
        ),
      );
    if (snapshot === null) return;
    yield* Effect.forEach(yield* projects.listShells().pipe(Effect.orDie), (project) =>
      scanProject(project).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to scan portable conversations for project", {
            projectId: project.id,
            workspaceRoot: project.workspaceRoot,
            cause,
          }),
        ),
      ),
    );
    const settingsChanges = yield* settingsService.subscribeChanges;
    yield* Stream.runForEach(settingsChanges, (settings) =>
      Effect.gen(function* () {
        const enabled = yield* Ref.get(enabledProjects);
        yield* Effect.forEach(
          [...enabled],
          ([projectId, workspaceRoot]) =>
            Effect.gen(function* () {
              const project = yield* projects.getShell(projectId);
              if (Option.isNone(project)) return;
              const scripts = resolveProjectScripts(settings, project.value);
              const manifest = yield* readManifest(workspaceRoot);
              if (
                Option.isSome(manifest) &&
                (yield* encodeProjectScripts(manifest.value.scripts ?? [])) ===
                  (yield* encodeProjectScripts(scripts))
              )
                return;
              yield* writeManifest(workspaceRoot, true, scripts);
            }),
          { concurrency: 1, discard: true },
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to mirror portable project actions", { cause }),
        ),
      ),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(events.streamApplicationEvents({ afterSequence }), (event) =>
      handleEvent(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to mirror portable conversation event", {
            eventType: "event" in event ? event.event.type : event.type,
            sequence: event.sequence,
            cause,
          }),
        ),
      ),
    ).pipe(Effect.forkScoped);
  });

  return ProjectConversationStorage.of({ getState, setEnabled, start });
});

export const ProjectConversationStorageLive = Layer.effect(
  ProjectConversationStorage,
  makeProjectConversationStorage,
);
