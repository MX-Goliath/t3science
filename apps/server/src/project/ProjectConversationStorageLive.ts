import {
  CommandId,
  PortableConversationDocument,
  PROJECT_CONVERSATION_STORAGE_DIRECTORY,
  PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
  ProjectConversationStorageError,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationThread,
  type ProjectId,
  ProviderDriverKind,
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
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { attachmentRelativePath, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { PortableConversationContext } from "../orchestration/Services/PortableConversationContext.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  ProjectConversationStorage,
  type ProjectConversationStorageShape,
} from "./ProjectConversationStorage.ts";

const MANIFEST_FILE_NAME = "manifest.json";
const THREADS_DIRECTORY_NAME = "threads";
const ATTACHMENTS_DIRECTORY_NAME = "attachments";

const Manifest = Schema.Struct({
  schemaVersion: Schema.Literal(PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION),
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
});
const ManifestJson = Schema.fromJsonString(Manifest);
const PortableConversationJson = Schema.fromJsonString(PortableConversationDocument);
const decodeManifest = Schema.decodeUnknownEffect(ManifestJson);
const decodePortableConversation = Schema.decodeUnknownEffect(PortableConversationJson);
const encodeManifest = Schema.encodeEffect(ManifestJson);
const encodePortableConversation = Schema.encodeEffect(PortableConversationJson);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

function storageError(message: string): ProjectConversationStorageError {
  return new ProjectConversationStorageError({ message });
}

function shouldExportEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.activity-appended":
    case "thread.turn-start-requested":
    case "thread.turn-interrupt-requested":
    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
    case "thread.checkpoint-revert-requested":
    case "thread.session-stop-requested":
    case "thread.portable-context-restored":
      return false;
    case "thread.message-sent":
      return event.payload.role !== "assistant" || !event.payload.streaming;
    case "thread.session-set":
      return (
        event.payload.session.status !== "starting" && event.payload.session.status !== "running"
      );
    default:
      return event.aggregateKind === "thread";
  }
}

export const makeProjectConversationStorage = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;
  const portableContext = yield* PortableConversationContext;
  const enabledProjects = yield* Ref.make(new Map<ProjectId, string>());
  const threadProjects = yield* Ref.make(new Map<ThreadId, ProjectId>());

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
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed(Option.none()) : Effect.fail(cause),
      ),
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
          Effect.catchTag("PlatformError", (cause) =>
            cause.reason._tag === "NotFound" ? Effect.succeed([] as string[]) : Effect.fail(cause),
          ),
        );
    },
  );

  const resolveProject = Effect.fn("ProjectConversationStorage.resolveProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* snapshots.getProjectShellById(projectId);
    if (Option.isNone(project)) {
      return yield* storageError(`Project '${projectId}' was not found.`);
    }
    return project.value;
  });

  const sourceProviderForThread = Effect.fn("ProjectConversationStorage.sourceProviderForThread")(
    function* (thread: OrchestrationThread) {
      if (isProviderDriverKind(thread.session?.providerName)) {
        return thread.session.providerName;
      }
      const provider = (yield* providers.getProviders).find(
        (entry) => entry.instanceId === thread.modelSelection.instanceId,
      );
      return provider?.driver ?? null;
    },
  );

  const copyThreadAttachmentsToProject = Effect.fn(
    "ProjectConversationStorage.copyThreadAttachmentsToProject",
  )(function* (workspaceRoot: string, thread: OrchestrationThread) {
    const attachments = thread.messages.flatMap((message) => message.attachments ?? []);
    yield* fileSystem.makeDirectory(attachmentsDirectory(workspaceRoot), { recursive: true });
    yield* Effect.forEach(
      attachments,
      (attachment) =>
        Effect.gen(function* () {
          const source = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment,
          });
          if (source === null || !(yield* fileSystem.exists(source))) return;
          const destination = path.join(
            attachmentsDirectory(workspaceRoot),
            attachmentRelativePath(attachment),
          );
          yield* fileSystem.writeFile(destination, yield* fileSystem.readFile(source));
        }),
      { concurrency: 1 },
    );
  });

  const exportThread = Effect.fn("ProjectConversationStorage.exportThread")(function* (
    workspaceRoot: string,
    thread: OrchestrationThread,
  ) {
    const exportedAt = yield* nowIso;
    const document: PortableConversationDocument = {
      schemaVersion: PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
      exportedAt,
      sourceProvider: yield* sourceProviderForThread(thread),
      thread: {
        ...thread,
        branch: null,
        worktreePath: null,
        session: null,
        latestTurn:
          thread.latestTurn?.state === "running"
            ? { ...thread.latestTurn, state: "interrupted", completedAt: exportedAt }
            : thread.latestTurn,
        messages: thread.messages.map((message) => ({ ...message, streaming: false })),
      },
    };
    yield* copyThreadAttachmentsToProject(workspaceRoot, thread);
    yield* writeAtomically({
      filePath: threadDocumentPath(workspaceRoot, thread.id),
      contents: `${yield* encodePortableConversation(document)}\n`,
    });
  });

  const writeManifest = Effect.fn("ProjectConversationStorage.writeManifest")(function* (
    workspaceRoot: string,
    enabled: boolean,
  ) {
    const manifest = {
      schemaVersion: PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION,
      enabled,
      updatedAt: yield* nowIso,
    } as const;
    yield* writeAtomically({
      filePath: manifestPath(workspaceRoot),
      contents: `${yield* encodeManifest(manifest)}\n`,
    });
  });

  const exportProject = Effect.fn("ProjectConversationStorage.exportProject")(function* (
    project: Pick<OrchestrationProject, "id" | "workspaceRoot">,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const projectThreads = snapshot.threads.filter(
      (thread) => thread.projectId === project.id && thread.deletedAt === null,
    );
    yield* Effect.forEach(projectThreads, (thread) => exportThread(project.workspaceRoot, thread), {
      concurrency: 1,
    });
    yield* writeManifest(project.workspaceRoot, true);
    yield* Ref.update(enabledProjects, (current) =>
      new Map(current).set(project.id, project.workspaceRoot),
    );
    yield* Ref.update(threadProjects, (current) => {
      const next = new Map(current);
      for (const thread of projectThreads) next.set(thread.id, project.id);
      return next;
    });
    return projectThreads.length;
  });

  const remapImportedThread = Effect.fn("ProjectConversationStorage.remapImportedThread")(
    function* (
      projectId: ProjectId,
      document: PortableConversationDocument,
    ): Effect.fn.Return<OrchestrationThread> {
      const available = yield* providers.getProviders;
      const exact = available.find(
        (entry) =>
          entry.instanceId === document.thread.modelSelection.instanceId &&
          entry.enabled &&
          entry.availability !== "unavailable",
      );
      const compatible = document.sourceProvider
        ? available.find(
            (entry) =>
              entry.driver === document.sourceProvider &&
              entry.enabled &&
              entry.availability !== "unavailable",
          )
        : undefined;
      const target = exact ?? compatible;
      return {
        ...document.thread,
        projectId,
        branch: null,
        worktreePath: null,
        session: null,
        modelSelection: target
          ? { ...document.thread.modelSelection, instanceId: target.instanceId }
          : document.thread.modelSelection,
      };
    },
  );

  const restoreThreadAttachments = Effect.fn("ProjectConversationStorage.restoreThreadAttachments")(
    function* (workspaceRoot: string, thread: OrchestrationThread) {
      const attachments = thread.messages.flatMap((message) => message.attachments ?? []);
      yield* Effect.forEach(
        attachments,
        (attachment) =>
          Effect.gen(function* () {
            const relativePath = attachmentRelativePath(attachment);
            const source = path.join(attachmentsDirectory(workspaceRoot), relativePath);
            if (!(yield* fileSystem.exists(source))) return;
            const destination = resolveAttachmentPath({
              attachmentsDir: config.attachmentsDir,
              attachment,
            });
            if (destination === null) return;
            yield* fileSystem.writeFile(destination, yield* fileSystem.readFile(source));
          }),
        { concurrency: 1 },
      );
    },
  );

  const importProject = Effect.fn("ProjectConversationStorage.importProject")(function* (
    project: Pick<OrchestrationProject, "id" | "workspaceRoot">,
  ) {
    const files = yield* listExportedThreadFiles(project.workspaceRoot);
    const snapshot = yield* snapshots.getSnapshot();
    const existingThreads = new Map(snapshot.threads.map((thread) => [thread.id, thread] as const));
    let imported = 0;

    for (const fileName of files) {
      const raw = yield* fileSystem.readFileString(
        path.join(threadsDirectory(project.workspaceRoot), fileName),
      );
      const document = yield* decodePortableConversation(raw);
      const existing = existingThreads.get(document.thread.id);
      if (existing !== undefined) {
        if (existing.projectId !== project.id || existing.updatedAt >= document.thread.updatedAt) {
          continue;
        }
      }
      const thread = yield* remapImportedThread(project.id, document);
      yield* restoreThreadAttachments(project.workspaceRoot, thread);
      const uuid = yield* crypto.randomUUIDv4;
      yield* engine.dispatch({
        type: "thread.portable.import",
        commandId: CommandId.make(`server:portable-import:${uuid}`),
        projectId: project.id,
        thread,
        createdAt: yield* nowIso,
      });
      yield* portableContext.markPending(thread.id);
      existingThreads.set(thread.id, thread);
      imported += 1;
    }
    return imported;
  });

  const stateForProject = Effect.fn("ProjectConversationStorage.stateForProject")(function* (
    project: Pick<OrchestrationProject, "id" | "workspaceRoot">,
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
          yield* importProject(project);
          yield* exportProject(project);
        } else {
          yield* writeManifest(project.workspaceRoot, false);
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
    project: Pick<OrchestrationProject, "id" | "workspaceRoot">,
  ) {
    const manifest = yield* readManifest(project.workspaceRoot);
    if (Option.isNone(manifest) || !manifest.value.enabled) return;
    yield* Ref.update(enabledProjects, (current) =>
      new Map(current).set(project.id, project.workspaceRoot),
    );
    yield* importProject(project);
  });

  const handleEvent = Effect.fn("ProjectConversationStorage.handleEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.type === "project.created" || event.type === "project.meta-updated") {
      const project = yield* snapshots.getProjectShellById(event.payload.projectId);
      if (Option.isSome(project)) yield* scanProject(project.value);
      return;
    }
    if (event.type === "project.deleted") {
      yield* Ref.update(enabledProjects, (current) => {
        const next = new Map(current);
        next.delete(event.payload.projectId);
        return next;
      });
      return;
    }
    if (event.aggregateKind !== "thread") return;

    if (event.type === "thread.created" || event.type === "thread.portable-imported") {
      const projectId =
        event.type === "thread.created" ? event.payload.projectId : event.payload.projectId;
      yield* Ref.update(threadProjects, (current) =>
        new Map(current).set(event.aggregateId as ThreadId, projectId),
      );
    }
    const projectId = (yield* Ref.get(threadProjects)).get(event.aggregateId as ThreadId);
    if (projectId === undefined) return;
    const workspaceRoot = (yield* Ref.get(enabledProjects)).get(projectId);
    if (workspaceRoot === undefined) return;

    if (event.type === "thread.deleted") {
      yield* fileSystem.remove(threadDocumentPath(workspaceRoot, event.payload.threadId), {
        force: true,
      });
      return;
    }
    if (!shouldExportEvent(event)) return;
    const thread = yield* snapshots.getThreadDetailById(event.aggregateId as ThreadId);
    if (Option.isSome(thread) && thread.value.deletedAt === null) {
      yield* exportThread(workspaceRoot, thread.value);
    }
  });

  const start: ProjectConversationStorageShape["start"] = Effect.fn(
    "ProjectConversationStorage.start",
  )(function* () {
    if (config.mode !== "desktop") return;
    const snapshot = yield* snapshots
      .getSnapshot()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to initialize project conversation storage", { cause }).pipe(
            Effect.as(null),
          ),
        ),
      );
    if (snapshot === null) return;
    yield* Ref.set(
      threadProjects,
      new Map(snapshot.threads.map((thread) => [thread.id, thread.projectId] as const)),
    );
    yield* Effect.forEach(snapshot.projects, (project) =>
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
    yield* Stream.runForEach(engine.streamDomainEvents, (event) =>
      handleEvent(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to mirror portable conversation event", {
            eventType: event.type,
            aggregateId: event.aggregateId,
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
