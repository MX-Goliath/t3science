import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type QwenCodeSettings,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { acpPermissionOutcome, mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import {
  applyQwenAcpModelSelection,
  makeQwenAcpRuntime,
  resolveQwenAcpRequestedModel,
} from "../acp/QwenAcpSupport.ts";
import type { QwenCodeAdapterShape } from "../Services/QwenCodeAdapter.ts";

const QWEN_CODE_PROVIDER = ProviderDriverKind.make("qwenCode");
const RESUME_VERSION = 1 as const;

export interface QwenCodeAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface QwenCodeSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
}

function parseResumeCursor(raw: unknown): { sessionId: string } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  return record.schemaVersion === RESUME_VERSION &&
    typeof record.sessionId === "string" &&
    record.sessionId.trim()
    ? { sessionId: record.sessionId.trim() }
    : undefined;
}

function selectPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: Exclude<ProviderApprovalDecision, "cancel">,
): string | undefined {
  const kind =
    decision === "acceptForSession"
      ? "allow_always"
      : decision === "accept"
        ? "allow_once"
        : "reject_once";
  return request.options.find((option) => option.kind === kind)?.optionId.trim() || undefined;
}

function selectAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  return (
    selectPermissionOptionId(request, "acceptForSession") ??
    selectPermissionOptionId(request, "accept")
  );
}

export function resolveQwenMode(
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode | undefined,
): string {
  if (interactionMode === "plan") return "plan";
  switch (runtimeMode) {
    case "approval-required":
      return "default";
    case "auto-accept-edits":
      return "auto-edit";
    case "auto":
      return "auto";
    case "full-access":
      return "yolo";
  }
}

export const makeQwenCodeAdapter = Effect.fn("makeQwenCodeAdapter")(function* (
  qwenSettings: QwenCodeSettings,
  options?: QwenCodeAdapterLiveOptions,
) {
  const provider = QWEN_CODE_PROVIDER;
  const agentName = "Qwen Code";
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make(provider);
  const resolveModel = resolveQwenAcpRequestedModel;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const sessions = new Map<ThreadId, QwenCodeSessionContext>();
  const locksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate Qwen Code runtime identifier.",
          cause,
        }),
    ),
  );
  const eventStamp = () =>
    Effect.all({ eventId: Effect.map(randomUuid, EventId.make), createdAt: nowIso });
  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const getLock = (threadId: string) =>
    SynchronizedRef.modifyEffect(locksRef, (current) => {
      const existing = Option.fromNullishOr(current.get(threadId));
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(threadId, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });
  const withLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getLock(threadId), (semaphore) => semaphore.withPermit(effect));
  const requireSession = (threadId: ThreadId) => {
    const session = sessions.get(threadId);
    return session && !session.stopped
      ? Effect.succeed(session)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider, threadId }));
  };

  const stopInternal = (ctx: QwenCodeSessionContext) =>
    Effect.gen(function* () {
      if (ctx.stopped) return;
      ctx.stopped = true;
      for (const pending of ctx.pendingApprovals.values()) {
        yield* Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore);
      }
      if (ctx.notificationFiber) yield* Fiber.interrupt(ctx.notificationFiber);
      yield* Scope.close(ctx.scope, Exit.void).pipe(Effect.ignore);
      sessions.delete(ctx.threadId);
      yield* publish({
        type: "session.exited",
        ...(yield* eventStamp()),
        provider,
        threadId: ctx.threadId,
        payload: { exitKind: "graceful" },
      });
    });

  const startSession: QwenCodeAdapterShape["startSession"] = (input) =>
    withLock(
      input.threadId,
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== provider) {
          return yield* new ProviderAdapterValidationError({
            provider,
            operation: "startSession",
            issue: `Expected provider '${provider}' but received '${input.provider}'.`,
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider,
            operation: "startSession",
            issue: "cwd is required and must be non-empty.",
          });
        }
        const existing = sessions.get(input.threadId);
        if (existing) yield* stopInternal(existing);
        const cwd = path.resolve(input.cwd.trim());
        const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
        const sessionScope = yield* Scope.make("sequential");
        let transferred = false;
        yield* Effect.addFinalizer(() =>
          transferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const acp = yield* makeQwenAcpRuntime({
          qwenSettings,
          ...(options?.environment ? { environment: options.environment } : {}),
          childProcessSpawner,
          cwd,
          ...(parseResumeCursor(input.resumeCursor)?.sessionId
            ? { resumeSessionId: parseResumeCursor(input.resumeCursor)!.sessionId }
            : {}),
          clientInfo: { name: "t3-code", version: "0.0.0" },
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );
        yield* acp.handleRequestPermission((params) =>
          Effect.gen(function* () {
            if (input.runtimeMode === "full-access") {
              const optionId = selectAutoApprovedPermissionOption(params);
              if (optionId) return { outcome: { outcome: "selected" as const, optionId } };
            }
            const permissionRequest = parsePermissionRequest(params);
            const requestId = ApprovalRequestId.make(yield* randomUuid);
            const runtimeRequestId = RuntimeRequestId.make(requestId);
            const decision = yield* Deferred.make<ProviderApprovalDecision>();
            pendingApprovals.set(requestId, { decision });
            yield* publish(
              makeAcpRequestOpenedEvent({
                stamp: yield* eventStamp(),
                provider,
                threadId: input.threadId,
                turnId: undefined,
                requestId: runtimeRequestId,
                permissionRequest,
                detail: permissionRequest.detail ?? `${agentName} permission request`,
                args: params,
                source: "acp.jsonrpc",
                method: "session/request_permission",
                rawPayload: params,
              }),
            );
            const resolved = yield* Deferred.await(decision);
            pendingApprovals.delete(requestId);
            yield* publish(
              makeAcpRequestResolvedEvent({
                stamp: yield* eventStamp(),
                provider,
                threadId: input.threadId,
                turnId: undefined,
                requestId: runtimeRequestId,
                permissionRequest,
                decision: resolved,
              }),
            );
            return resolved === "cancel"
              ? ({
                  outcome: { outcome: "cancelled" as const },
                } satisfies EffectAcpSchema.RequestPermissionResponse)
              : ({
                  outcome: {
                    outcome: "selected" as const,
                    optionId: acpPermissionOutcome(resolved),
                  },
                } satisfies EffectAcpSchema.RequestPermissionResponse);
          }).pipe(
            Effect.mapError(
              (cause) =>
                new EffectAcpErrors.AcpTransportError({
                  detail: "Failed to process Qwen Code ACP permission request.",
                  cause,
                }),
            ),
          ),
        );
        const started = yield* acp
          .start()
          .pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(provider, input.threadId, "session/start", cause),
            ),
          );
        yield* acp.setMode(resolveQwenMode(input.runtimeMode, undefined)).pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(provider, input.threadId, "session/set_mode", cause),
          ),
          Effect.asVoid,
        );
        const selectedModel =
          input.modelSelection?.instanceId === boundInstanceId
            ? resolveModel(input.modelSelection.model)
            : undefined;
        yield* applyQwenAcpModelSelection({
          runtime: acp,
          model: selectedModel,
          mapError: (cause) =>
            mapAcpToAdapterError(provider, input.threadId, "session/set_model", cause),
        });
        const timestamp = yield* nowIso;
        const session: ProviderSession = {
          provider,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          ...(selectedModel ? { model: selectedModel } : {}),
          threadId: input.threadId,
          resumeCursor: { schemaVersion: RESUME_VERSION, sessionId: started.sessionId },
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const ctx: QwenCodeSessionContext = {
          threadId: input.threadId,
          session,
          scope: sessionScope,
          acp,
          notificationFiber: undefined,
          pendingApprovals,
          turns: [],
          activeTurnId: undefined,
          stopped: false,
        };
        const notificationFiber = yield* Stream.runDrain(
          Stream.mapEffect(acp.getEvents(), (event) =>
            Effect.gen(function* () {
              if (event._tag === "EventStreamBarrier") {
                yield* Deferred.succeed(event.acknowledge, undefined);
                return;
              }
              const turnId = ctx.activeTurnId;
              if (!turnId) return;
              const stamp = yield* eventStamp();
              switch (event._tag) {
                case "ModeChanged":
                  return;
                case "AssistantItemStarted":
                  yield* publish(
                    makeAcpAssistantItemEvent({
                      stamp,
                      provider,
                      threadId: ctx.threadId,
                      turnId,
                      itemId: event.itemId,
                      lifecycle: "item.started",
                    }),
                  );
                  return;
                case "AssistantItemCompleted":
                  yield* publish(
                    makeAcpAssistantItemEvent({
                      stamp,
                      provider,
                      threadId: ctx.threadId,
                      turnId,
                      itemId: event.itemId,
                      lifecycle: "item.completed",
                    }),
                  );
                  return;
                case "PlanUpdated":
                  yield* publish(
                    makeAcpPlanUpdatedEvent({
                      stamp,
                      provider,
                      threadId: ctx.threadId,
                      turnId,
                      payload: event.payload,
                      source: "acp.jsonrpc",
                      method: "session/update",
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "ToolCallUpdated":
                  yield* publish(
                    makeAcpToolCallEvent({
                      stamp,
                      provider,
                      threadId: ctx.threadId,
                      turnId,
                      toolCall: event.toolCall,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "ContentDelta":
                  yield* publish(
                    makeAcpContentDeltaEvent({
                      stamp,
                      provider,
                      threadId: ctx.threadId,
                      turnId,
                      ...(event.itemId ? { itemId: event.itemId } : {}),
                      text: event.text,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
              }
            }),
          ),
        ).pipe(
          Effect.catch(() => Effect.void),
          Effect.forkChild,
        );
        ctx.notificationFiber = notificationFiber;
        sessions.set(input.threadId, ctx);
        transferred = true;
        yield* publish({
          type: "session.started",
          ...(yield* eventStamp()),
          provider,
          threadId: input.threadId,
          payload: { resume: started.initializeResult },
        });
        yield* publish({
          type: "session.state.changed",
          ...(yield* eventStamp()),
          provider,
          threadId: input.threadId,
          payload: { state: "ready", reason: `${agentName} ACP session ready` },
        });
        yield* publish({
          type: "thread.started",
          ...(yield* eventStamp()),
          provider,
          threadId: input.threadId,
          payload: { providerThreadId: started.sessionId },
        });
        return session;
      }).pipe(Effect.scoped),
    );

  const sendTurn: QwenCodeAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      const turnId = ctx.activeTurnId ?? TurnId.make(yield* randomUuid);
      const selectedModel =
        input.modelSelection?.instanceId === boundInstanceId
          ? resolveModel(input.modelSelection.model)
          : ctx.session.model;
      yield* ctx.acp.setMode(resolveQwenMode(ctx.session.runtimeMode, input.interactionMode)).pipe(
        Effect.mapError((cause) =>
          mapAcpToAdapterError(provider, input.threadId, "session/set_mode", cause),
        ),
        Effect.asVoid,
      );
      yield* applyQwenAcpModelSelection({
        runtime: ctx.acp,
        model: selectedModel,
        mapError: (cause) =>
          mapAcpToAdapterError(provider, input.threadId, "session/set_model", cause),
      });
      const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
      if (input.input?.trim()) promptParts.push({ type: "text", text: input.input.trim() });
      for (const attachment of input.attachments ?? []) {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new ProviderAdapterRequestError({
            provider,
            method: "session/prompt",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider,
                method: "session/prompt",
                detail: cause.message,
                cause,
              }),
          ),
        );
        promptParts.push({
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        });
      }
      if (promptParts.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }
      const isNewTurn = ctx.activeTurnId === undefined;
      ctx.activeTurnId = turnId;
      ctx.session = {
        ...ctx.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt: yield* nowIso,
        ...(selectedModel ? { model: selectedModel } : {}),
      };
      if (isNewTurn)
        yield* publish({
          type: "turn.started",
          ...(yield* eventStamp()),
          provider,
          threadId: input.threadId,
          turnId,
          payload: selectedModel ? { model: selectedModel } : {},
        });
      const result = yield* ctx.acp
        .prompt({ prompt: promptParts })
        .pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(provider, input.threadId, "session/prompt", cause),
          ),
        );
      ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
      if (ctx.activeTurnId === turnId) {
        const updatedAt = yield* nowIso;
        const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
        ctx.activeTurnId = undefined;
        ctx.session = { ...readySession, status: "ready", updatedAt };
        yield* publish({
          type: "turn.completed",
          ...(yield* eventStamp()),
          provider,
          threadId: input.threadId,
          turnId,
          payload: {
            state: result.stopReason === "cancelled" ? "cancelled" : "completed",
            stopReason: result.stopReason ?? null,
          },
        });
      }
      return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
    });

  const interruptTurn: QwenCodeAdapterShape["interruptTurn"] = (threadId, requestedTurnId) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      if (requestedTurnId && ctx.activeTurnId && requestedTurnId !== ctx.activeTurnId) return;
      const turnId = ctx.activeTurnId;
      for (const pending of ctx.pendingApprovals.values())
        yield* Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore);
      yield* ctx.acp.cancel.pipe(Effect.ignore);
      if (turnId) {
        ctx.activeTurnId = undefined;
        const updatedAt = yield* nowIso;
        const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
        ctx.session = { ...readySession, status: "ready", updatedAt };
        yield* publish({
          type: "turn.completed",
          ...(yield* eventStamp()),
          provider,
          threadId,
          turnId,
          payload: { state: "cancelled", stopReason: "cancelled" },
        });
      }
    });

  const respondToRequest: QwenCodeAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const pending = ctx.pendingApprovals.get(requestId);
      if (!pending)
        return yield* new ProviderAdapterRequestError({
          provider,
          method: "session/request_permission",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      yield* Deferred.succeed(pending.decision, decision);
    });
  const respondToUserInput: QwenCodeAdapterShape["respondToUserInput"] = (
    threadId,
    _requestId,
    _answers: ProviderUserInputAnswers,
  ) =>
    Effect.gen(function* () {
      yield* requireSession(threadId);
      return yield* new ProviderAdapterRequestError({
        provider,
        method: "session/elicitation",
        detail: `${agentName} ACP does not expose structured user-input requests.`,
      });
    });
  const readThread: QwenCodeAdapterShape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      return { threadId, turns: ctx.turns };
    });
  const rollbackThread: QwenCodeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1)
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      return yield* new ProviderAdapterRequestError({
        provider,
        method: "thread/rollback",
        detail: `${agentName} ACP sessions do not support provider-side rollback.`,
      });
    });
  const stopSession: QwenCodeAdapterShape["stopSession"] = (threadId) =>
    withLock(threadId, requireSession(threadId).pipe(Effect.flatMap(stopInternal)));
  const listSessions: QwenCodeAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));
  const hasSession: QwenCodeAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const ctx = sessions.get(threadId);
      return ctx !== undefined && !ctx.stopped;
    });
  const stopAll: QwenCodeAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopInternal, { discard: true });
  yield* Effect.addFinalizer(() =>
    stopAll().pipe(
      Effect.ignore,
      Effect.tap(() => PubSub.shutdown(events)),
    ),
  );
  return {
    provider,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies QwenCodeAdapterShape;
});
