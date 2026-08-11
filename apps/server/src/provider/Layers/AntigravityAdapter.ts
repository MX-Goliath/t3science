/**
 * AntigravityAdapter — provider adapter for the Antigravity CLI (`agy`).
 *
 * Unlike the long-lived protocol adapters (Codex app-server, ACP, OpenCode
 * server), `agy` has no resident process: headless mode runs exactly one turn
 * per invocation and streams NDJSON on stdout. The session this adapter owns is
 * therefore bookkeeping — working directory, permission mode, selected model,
 * and the CLI conversation id used to resume — while each turn owns a child
 * process for its lifetime.
 *
 * Consequences worth knowing before changing anything here:
 *
 *   - **Continuation is the conversation id.** The first turn opens a new CLI
 *     project bound to the thread's cwd; every later turn resumes with
 *     `--conversation`. The id lands in the session's `resumeCursor`, so a
 *     server restart recovers the thread with full CLI-side history.
 *   - **Turns are serialized, not steered.** A message sent while a turn runs
 *     cannot be injected into the running process, so it waits on the thread
 *     lock and then runs as its own turn.
 *   - **Approvals do not exist.** Headless `agy` auto-denies anything that
 *     would need a prompt, so `respondToRequest` is unreachable; the adapter
 *     explains the denial once per turn instead of opening a request.
 *
 * @module provider/Layers/AntigravityAdapter
 */
import {
  type AntigravitySettings,
  type ApprovalRequestId,
  EventId,
  type ProviderInteractionMode,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type RuntimeMode,
  RuntimeItemId,
  type RuntimeItemStatus,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { AntigravityAdapterShape } from "../Services/AntigravityAdapter.ts";
import {
  accumulateAntigravityUsage,
  antigravityStepKind,
  antigravityToolItemData,
  antigravityToolTitle,
  antigravityUsageSnapshot,
  canonicalItemTypeForAntigravityStep,
  emptyAntigravityUsageAccumulator,
  isAntigravityPermissionDenial,
  isAntigravitySubagentTool,
  parseAntigravityStreamLine,
  runtimeItemStatusForAntigravityStep,
  type AntigravityStepUpdate,
  type AntigravityStreamEvent,
  type AntigravityUsageAccumulator,
} from "./antigravityStreamJson.ts";
import {
  antigravityPermissionPlan,
  buildAntigravityTurnArgs,
  isAntigravityPromptTooLongForPlatform,
  resolveAntigravityLaunchArgs,
  ANTIGRAVITY_WINDOWS_PROMPT_LIMIT,
} from "./antigravityLaunchArgs.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const ANTIGRAVITY_RESUME_VERSION = 1 as const;
/** Keep the tail of stderr for diagnostics without buffering a runaway log. */
const MAX_STDERR_CHARS = 8_000;

export interface AntigravityAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly instanceId?: ProviderInstanceId;
}

export interface AntigravityResumeCursor {
  readonly schemaVersion: typeof ANTIGRAVITY_RESUME_VERSION;
  readonly conversationId: string;
  readonly cwd: string;
}

interface ActiveTurnProcess {
  readonly turnId: TurnId;
  readonly terminate: Effect.Effect<void>;
}

interface AntigravitySessionContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  session: ProviderSession;
  /** CLI conversation id; undefined until the first turn's `init` event. */
  conversationId: string | undefined;
  model: string | undefined;
  runtimeMode: RuntimeMode;
  activeTurnId: TurnId | undefined;
  activeProcess: ActiveTurnProcess | undefined;
  readonly interruptedTurnIds: Set<TurnId>;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  usage: AntigravityUsageAccumulator;
  stopped: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAntigravityResumeCursor(raw: unknown): AntigravityResumeCursor | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== ANTIGRAVITY_RESUME_VERSION) return undefined;
  if (typeof raw.conversationId !== "string" || raw.conversationId.trim().length === 0) {
    return undefined;
  }
  const cwd = typeof raw.cwd === "string" ? raw.cwd.trim() : "";
  return {
    schemaVersion: ANTIGRAVITY_RESUME_VERSION,
    conversationId: raw.conversationId.trim(),
    cwd,
  };
}

function makeResumeCursor(input: {
  readonly conversationId: string | undefined;
  readonly cwd: string;
}): AntigravityResumeCursor | undefined {
  if (!input.conversationId) return undefined;
  return {
    schemaVersion: ANTIGRAVITY_RESUME_VERSION,
    conversationId: input.conversationId,
    cwd: input.cwd,
  };
}

/**
 * Per-turn view of everything the stream handler mutates. Kept separate from
 * the session so a turn that outlives its relevance (interrupted, superseded)
 * cannot write stale state back onto the session.
 */
interface TurnStreamState {
  /** Item ids already announced, keyed by CLI step index. */
  readonly startedItems: Map<number, string>;
  /** Step indices whose lifecycle already completed. */
  readonly completedItems: Set<number>;
  assistantTextSeen: boolean;
  permissionNoticeEmitted: boolean;
  sawResult: boolean;
  resultStatus: "SUCCESS" | "ERROR" | "CANCELLED" | "UNKNOWN" | undefined;
  resultError: string | undefined;
  resultResponse: string | undefined;
  toolUses: number;
}

function makeTurnStreamState(): TurnStreamState {
  return {
    startedItems: new Map(),
    completedItems: new Set(),
    assistantTextSeen: false,
    permissionNoticeEmitted: false,
    sawResult: false,
    resultStatus: undefined,
    resultError: undefined,
    resultResponse: undefined,
    toolUses: 0,
  };
}

export function makeAntigravityAdapter(
  settings: AntigravitySettings,
  options?: AntigravityAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("antigravity");
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostPlatform = yield* HostProcessPlatform;
    const environment = options?.environment ?? process.env;
    const binaryPath = settings.binaryPath || "agy";
    const launchArgs = resolveAntigravityLaunchArgs(settings.launchArgs, environment);

    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate an Antigravity runtime identifier.",
            cause,
          }),
      ),
      Effect.orDie,
    );
    const makeEventStamp = () =>
      Effect.all({ eventId: Effect.map(randomUUIDv4, EventId.make), createdAt: nowIso });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const logNativeEvent = (threadId: ThreadId, payload: unknown) =>
      nativeEventLogger ? nativeEventLogger.write(payload, threadId) : Effect.void;

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          current.get(threadId),
        );
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

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<AntigravitySessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const touchSession = (ctx: AntigravitySessionContext, patch: Partial<ProviderSession>) =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        ctx.session = { ...ctx.session, ...patch, updatedAt };
      });

    // ── stream → runtime events ─────────────────────────────────────

    const itemIdForStep = (turnId: TurnId, stepIndex: number) => `${turnId}:step-${stepIndex}`;

    const emitStepStarted = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly step: AntigravityStepUpdate;
      readonly state: TurnStreamState;
      readonly raw: unknown;
    }) =>
      Effect.gen(function* () {
        const { ctx, turnId, step, state } = input;
        if (state.startedItems.has(step.stepIndex)) return;
        const itemId = itemIdForStep(turnId, step.stepIndex);
        state.startedItems.set(step.stepIndex, itemId);
        const kind = antigravityStepKind(step);
        const itemType = canonicalItemTypeForAntigravityStep(step);
        if (kind === "tool") {
          state.toolUses += 1;
        }
        yield* offerRuntimeEvent({
          type: "item.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          itemId: RuntimeItemId.make(itemId),
          payload: {
            itemType,
            status: "inProgress",
            ...(kind === "tool" ? { title: antigravityToolTitle(step) } : {}),
            ...(kind === "tool" ? { data: antigravityToolItemData(step) } : {}),
          },
          providerRefs: { providerTurnId: ctx.conversationId ?? turnId },
          raw: {
            source: "antigravity.stream-json",
            method: "step_update",
            messageType: step.stepType,
            payload: input.raw,
          },
        });
      });

    const emitStepCompleted = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly step: AntigravityStepUpdate;
      readonly state: TurnStreamState;
      readonly raw: unknown;
    }) =>
      Effect.gen(function* () {
        const { ctx, turnId, step, state } = input;
        if (state.completedItems.has(step.stepIndex)) return;
        state.completedItems.add(step.stepIndex);
        const itemId =
          state.startedItems.get(step.stepIndex) ?? itemIdForStep(turnId, step.stepIndex);
        state.startedItems.set(step.stepIndex, itemId);
        const kind = antigravityStepKind(step);
        const status: RuntimeItemStatus = runtimeItemStatusForAntigravityStep(step);
        const detail = step.toolInfo?.error?.message;
        yield* offerRuntimeEvent({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          itemId: RuntimeItemId.make(itemId),
          payload: {
            itemType: canonicalItemTypeForAntigravityStep(step),
            status,
            ...(kind === "tool" ? { title: antigravityToolTitle(step) } : {}),
            ...(detail ? { detail } : {}),
            ...(kind === "tool" ? { data: antigravityToolItemData(step) } : {}),
          },
          providerRefs: { providerTurnId: ctx.conversationId ?? turnId },
          raw: {
            source: "antigravity.stream-json",
            method: "step_update",
            messageType: step.stepType,
            payload: input.raw,
          },
        });

        if (kind === "tool" && isAntigravityPermissionDenial(step)) {
          yield* offerRuntimeEvent({
            type: "tool.denied",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: ctx.threadId,
            turnId,
            itemId: RuntimeItemId.make(itemId),
            payload: {
              toolName: step.toolName ?? step.toolInfo?.name ?? "tool",
              toolUseId: itemId,
              ...(detail ? { reason: detail } : {}),
            },
          });
          if (!state.permissionNoticeEmitted) {
            state.permissionNoticeEmitted = true;
            const plan = antigravityPermissionPlan({ runtimeMode: ctx.runtimeMode });
            yield* offerRuntimeEvent({
              type: "runtime.warning",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: ctx.threadId,
              turnId,
              payload: {
                message:
                  plan.degraded ??
                  "Antigravity denied a tool that required approval because headless mode cannot prompt.",
              },
            });
          }
        }
      });

    const emitContentDelta = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly stepIndex: number;
      readonly itemId: string;
      readonly delta: string;
      readonly streamKind: "assistant_text" | "reasoning_text";
      readonly raw: unknown;
    }) =>
      makeEventStamp().pipe(
        Effect.flatMap((stamp) =>
          offerRuntimeEvent({
            type: "content.delta",
            ...stamp,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.ctx.threadId,
            turnId: input.turnId,
            itemId: RuntimeItemId.make(input.itemId),
            payload: {
              streamKind: input.streamKind,
              delta: input.delta,
              contentIndex: input.stepIndex,
            },
            raw: {
              source: "antigravity.stream-json",
              method: "step_update",
              payload: input.raw,
            },
          }),
        ),
      );

    const handleStepEvent = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly step: AntigravityStepUpdate;
      readonly state: TurnStreamState;
      readonly raw: unknown;
    }) =>
      Effect.gen(function* () {
        const { ctx, turnId, step, state } = input;
        const kind = antigravityStepKind(step);
        if (kind === "silent") return;
        // `error_message` steps are markers: the human-readable failure always
        // arrives on the result envelope, so an empty one would only add a
        // blank error row to the timeline.
        if (kind === "error" && !step.textDelta && !step.toolInfo?.error) return;

        const isTerminal = step.state.toUpperCase() !== "ACTIVE";
        yield* emitStepStarted({ ctx, turnId, step, state, raw: input.raw });
        const itemId =
          state.startedItems.get(step.stepIndex) ?? itemIdForStep(turnId, step.stepIndex);

        if ((kind === "assistant" || kind === "reasoning") && step.textDelta) {
          if (kind === "assistant" && step.textDelta.trim().length > 0) {
            state.assistantTextSeen = true;
          }
          yield* emitContentDelta({
            ctx,
            turnId,
            stepIndex: step.stepIndex,
            itemId,
            delta: step.textDelta,
            streamKind: kind === "assistant" ? "assistant_text" : "reasoning_text",
            raw: input.raw,
          });
        }

        if (kind === "tool" && !isTerminal) {
          yield* offerRuntimeEvent({
            type: "tool.progress",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: ctx.threadId,
            turnId,
            itemId: RuntimeItemId.make(itemId),
            payload: {
              toolUseId: itemId,
              toolName: step.toolName ?? step.toolInfo?.name ?? "tool",
              summary: antigravityToolTitle(step),
              ...(step.durationSeconds !== undefined
                ? { elapsedSeconds: step.durationSeconds }
                : {}),
            },
          });
        }

        if (step.usage) {
          ctx.usage = accumulateAntigravityUsage(ctx.usage, step.usage);
        }

        if (isTerminal) {
          yield* emitStepCompleted({ ctx, turnId, step, state, raw: input.raw });
          if (kind === "tool" && isAntigravitySubagentTool(step.toolName)) {
            // Subagent activity is opaque in the headless stream — surface the
            // invocation as a completed task so the Agents surface is not empty.
            yield* offerRuntimeEvent({
              type: "task.completed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: ctx.threadId,
              turnId,
              payload: {
                taskId: RuntimeTaskId.make(itemId),
                status:
                  runtimeItemStatusForAntigravityStep(step) === "completed"
                    ? "completed"
                    : "failed",
                ...(step.toolInfo?.output ? { summary: step.toolInfo.output.slice(0, 2_000) } : {}),
                taskType: "subagent",
                toolUseId: itemId,
              },
            });
          }
        }
      });

    const handleStreamEvent = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly event: AntigravityStreamEvent;
      readonly state: TurnStreamState;
    }) =>
      Effect.gen(function* () {
        const { ctx, turnId, event, state } = input;
        yield* logNativeEvent(ctx.threadId, event.raw);
        switch (event._tag) {
          case "init": {
            const conversationId = event.init.conversationId;
            const isNewConversation =
              conversationId !== undefined && conversationId !== ctx.conversationId;
            if (conversationId) {
              ctx.conversationId = conversationId;
              yield* touchSession(ctx, {
                resumeCursor: makeResumeCursor({ conversationId, cwd: ctx.cwd }),
              });
            }
            if (event.init.model) {
              ctx.model = event.init.model;
            }
            if (isNewConversation) {
              yield* offerRuntimeEvent({
                type: "thread.started",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                providerInstanceId: boundInstanceId,
                threadId: ctx.threadId,
                turnId,
                payload: { providerThreadId: conversationId },
              });
            }
            yield* offerRuntimeEvent({
              type: "session.configured",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: ctx.threadId,
              turnId,
              payload: {
                config: {
                  ...(event.init.model ? { model: event.init.model } : {}),
                  ...(event.init.cwd ? { cwd: event.init.cwd } : {}),
                  ...(event.init.permissionMode
                    ? { permissionMode: event.init.permissionMode }
                    : {}),
                  ...(event.init.tools ? { tools: event.init.tools } : {}),
                },
              },
              raw: {
                source: "antigravity.stream-json",
                method: "init",
                payload: event.raw,
              },
            });
            return;
          }
          case "step":
            yield* handleStepEvent({ ctx, turnId, step: event.step, state, raw: event.raw });
            return;
          case "result": {
            state.sawResult = true;
            state.resultStatus = event.result.status;
            state.resultError = event.result.error;
            state.resultResponse = event.result.response;
            if (event.result.conversationId) {
              ctx.conversationId = event.result.conversationId;
              yield* touchSession(ctx, {
                resumeCursor: makeResumeCursor({
                  conversationId: event.result.conversationId,
                  cwd: ctx.cwd,
                }),
              });
            }
            if (event.result.usage) {
              ctx.usage = accumulateAntigravityUsage(ctx.usage, event.result.usage);
            }
            return;
          }
          case "error": {
            yield* offerRuntimeEvent({
              type: "runtime.error",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: ctx.threadId,
              turnId,
              payload: { message: event.message, class: "provider_error" },
              raw: {
                source: "antigravity.stream-json",
                method: "error",
                payload: event.raw,
              },
            });
            return;
          }
          case "unknown":
            return;
        }
      });

    // ── SPI ─────────────────────────────────────────────────────────

    const stopSessionInternal = (ctx: AntigravitySessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        const active = ctx.activeProcess;
        if (active) {
          ctx.interruptedTurnIds.add(active.turnId);
          yield* active.terminate;
        }
        sessions.delete(ctx.threadId);
        yield* offerRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: AntigravityAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          const resume = parseAntigravityResumeCursor(input.resumeCursor);
          const rawCwd = input.cwd?.trim() || resume?.cwd || "";
          if (!rawCwd) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }
          const cwd = path.resolve(rawCwd);

          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const model =
            input.modelSelection?.instanceId === boundInstanceId
              ? input.modelSelection.model
              : undefined;
          const createdAt = yield* nowIso;
          const resumeCursor = makeResumeCursor({
            conversationId: resume?.conversationId,
            cwd,
          });
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            ...(model ? { model } : {}),
            threadId: input.threadId,
            ...(resumeCursor ? { resumeCursor } : {}),
            createdAt,
            updatedAt: createdAt,
          };
          const ctx: AntigravitySessionContext = {
            threadId: input.threadId,
            cwd,
            session,
            conversationId: resume?.conversationId,
            model,
            runtimeMode: input.runtimeMode,
            activeTurnId: undefined,
            activeProcess: undefined,
            interruptedTurnIds: new Set(),
            turns: [],
            usage: emptyAntigravityUsageAccumulator,
            stopped: false,
          };
          sessions.set(input.threadId, ctx);

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            payload: {
              ...(resume ? { resume: { conversationId: resume.conversationId } } : {}),
            },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            payload: { state: "ready" },
          });

          return { ...ctx.session };
        }),
      );

    const runTurnProcess = (input: {
      readonly ctx: AntigravitySessionContext;
      readonly turnId: TurnId;
      readonly prompt: string;
      readonly model: string | undefined;
      readonly interactionMode: ProviderInteractionMode | undefined;
      readonly state: TurnStreamState;
    }) =>
      Effect.gen(function* () {
        const { ctx, turnId, state } = input;
        const args = buildAntigravityTurnArgs({
          prompt: input.prompt,
          ...(input.model ? { model: input.model } : {}),
          ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
          runtimeMode: ctx.runtimeMode,
          ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
          launchArgs,
        });
        const spawnCommand = yield* resolveSpawnCommand(binaryPath, [...args], {
          env: environment,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: ctx.threadId,
                detail: `Failed to resolve the Antigravity binary '${binaryPath}'.`,
                cause,
              }),
          ),
        );

        return yield* Effect.gen(function* () {
          const turnScope = yield* Scope.Scope;
          const child = yield* spawner
            .spawn(
              ChildProcess.make(spawnCommand.command, spawnCommand.args, {
                cwd: ctx.cwd,
                env: environment,
                shell: spawnCommand.shell,
                detached: hostPlatform !== "win32",
              }),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER,
                    threadId: ctx.threadId,
                    detail: `Failed to spawn '${binaryPath}'.`,
                    cause,
                  }),
              ),
            );

          // Kill the whole process group: `agy` runs a language server and the
          // tools it starts are its own children, so terminating just the
          // direct child would leave them holding the workspace. SIGINT is
          // swallowed by the CLI (there it means "clear the prompt"), so
          // termination starts at SIGTERM.
          const killGroup = (signal: NodeJS.Signals) =>
            (hostPlatform === "win32"
              ? Effect.void
              : Effect.sync(() => {
                  try {
                    process.kill(-Number(child.pid), signal);
                  } catch {
                    // Already gone, or never became a group leader; the direct
                    // kill below is the backstop.
                  }
                })
            ).pipe(Effect.andThen(child.kill({ killSignal: signal }).pipe(Effect.ignore)));
          ctx.activeProcess = {
            turnId,
            // The caller waits only for the signal, never for the escalation:
            // a CLI that ignores SIGTERM must not stall the interrupt path.
            terminate: killGroup("SIGTERM").pipe(
              Effect.andThen(
                Effect.sleep("2 seconds").pipe(
                  Effect.andThen(killGroup("SIGKILL")),
                  Effect.ignore,
                  Effect.forkIn(turnScope),
                ),
              ),
              Effect.asVoid,
            ),
          };

          const stderrRef = yield* Ref.make("");
          const [, , exitCode] = yield* Effect.all(
            [
              child.stdout.pipe(
                Stream.decodeText(),
                Stream.splitLines,
                Stream.runForEach((line) => {
                  const event = parseAntigravityStreamLine(line);
                  return event === undefined
                    ? Effect.void
                    : handleStreamEvent({ ctx, turnId, event, state });
                }),
                Effect.ignore,
              ),
              child.stderr.pipe(
                Stream.decodeText(),
                Stream.runForEach((chunk) =>
                  Ref.update(stderrRef, (current) => `${current}${chunk}`.slice(-MAX_STDERR_CHARS)),
                ),
                Effect.ignore,
              ),
              child.exitCode.pipe(
                Effect.map(Number),
                Effect.orElseSucceed(() => -1),
              ),
            ],
            { concurrency: "unbounded" },
          );
          const stderr = yield* Ref.get(stderrRef);
          return { exitCode, stderr };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (ctx.activeProcess?.turnId === turnId) {
                ctx.activeProcess = undefined;
              }
            }),
          ),
          Effect.scoped,
        );
      });

    const sendTurn: AntigravityAdapterShape["sendTurn"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(input.threadId);
          const prompt = input.input?.trim() ?? "";
          if (prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text.",
            });
          }
          if (isAntigravityPromptTooLongForPlatform({ prompt, platform: hostPlatform })) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: `Antigravity receives the prompt as a command-line argument, which Windows caps at ${ANTIGRAVITY_WINDOWS_PROMPT_LIMIT} characters. Shorten the message or move the context into a file.`,
            });
          }

          const turnId = TurnId.make(yield* randomUUIDv4);
          const model =
            input.modelSelection?.instanceId === boundInstanceId
              ? (input.modelSelection.model ?? ctx.model)
              : ctx.model;
          ctx.activeTurnId = turnId;
          ctx.model = model;
          ctx.usage = emptyAntigravityUsageAccumulator;
          yield* touchSession(ctx, {
            status: "running",
            activeTurnId: turnId,
            ...(model ? { model } : {}),
          });

          yield* offerRuntimeEvent({
            type: "turn.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId,
            payload: { ...(model ? { model } : {}) },
          });

          const state = makeTurnStreamState();
          const outcome = yield* runTurnProcess({
            ctx,
            turnId,
            prompt,
            model,
            interactionMode: input.interactionMode,
            state,
          }).pipe(Effect.result);

          const interrupted = ctx.interruptedTurnIds.delete(turnId);
          ctx.usage = { ...ctx.usage, toolUses: state.toolUses };

          // A print-mode command (`/usage`, `/model`, …) resolves without ever
          // opening an assistant step, and so does a turn whose only output is
          // the final response. Either way the text must still reach the
          // timeline.
          if (!state.assistantTextSeen && state.resultResponse?.trim()) {
            const itemId = `${turnId}:result`;
            yield* offerRuntimeEvent({
              type: "item.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: input.threadId,
              turnId,
              itemId: RuntimeItemId.make(itemId),
              payload: { itemType: "assistant_message", status: "inProgress" },
            });
            yield* emitContentDelta({
              ctx,
              turnId,
              stepIndex: 0,
              itemId,
              delta: state.resultResponse,
              streamKind: "assistant_text",
              raw: undefined,
            });
            yield* offerRuntimeEvent({
              type: "item.completed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: input.threadId,
              turnId,
              itemId: RuntimeItemId.make(itemId),
              payload: { itemType: "assistant_message", status: "completed" },
            });
          }

          const usage = antigravityUsageSnapshot(ctx.usage);
          if (usage.usedTokens > 0) {
            yield* offerRuntimeEvent({
              type: "thread.token-usage.updated",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: input.threadId,
              turnId,
              payload: { usage },
            });
          }

          ctx.turns = [
            ...ctx.turns,
            {
              id: turnId,
              items: [
                {
                  prompt,
                  ...(model ? { model } : {}),
                  ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
                  ...(state.resultResponse !== undefined ? { response: state.resultResponse } : {}),
                },
              ],
            },
          ];

          const spawnFailure = outcome._tag === "Failure" ? outcome.failure : undefined;
          const exitCode = outcome._tag === "Success" ? outcome.success.exitCode : -1;
          const stderrTail = outcome._tag === "Success" ? outcome.success.stderr.trim() : "";
          const failureMessage = interrupted
            ? undefined
            : (spawnFailure?.message ??
              state.resultError ??
              (state.resultStatus === "ERROR"
                ? "Antigravity reported a failed turn."
                : undefined) ??
              (state.sawResult
                ? undefined
                : exitCode === 0
                  ? "Antigravity exited without reporting a result."
                  : `Antigravity exited with code ${exitCode}.${stderrTail ? ` ${lastLine(stderrTail)}` : ""}`));

          if (failureMessage) {
            yield* offerRuntimeEvent({
              type: "runtime.error",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: input.threadId,
              turnId,
              payload: {
                message: failureMessage,
                class: spawnFailure ? "transport_error" : "provider_error",
              },
            });
          }

          const turnState = interrupted ? "interrupted" : failureMessage ? "failed" : "completed";
          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId,
            payload: {
              state: turnState,
              stopReason: interrupted ? "interrupted" : (state.resultStatus?.toLowerCase() ?? null),
              usage,
              ...(failureMessage ? { errorMessage: failureMessage } : {}),
            },
          });

          ctx.activeTurnId = undefined;
          const { activeTurnId: _activeTurnId, ...idleSession } = ctx.session;
          ctx.session = { ...idleSession, status: "ready", updatedAt: yield* nowIso };

          return {
            threadId: input.threadId,
            turnId,
            ...(ctx.session.resumeCursor !== undefined
              ? { resumeCursor: ctx.session.resumeCursor }
              : {}),
          };
        }),
      );

    /**
     * Interrupt does not take the thread lock: the lock is held for the whole
     * duration of the turn it must stop. It reads the live process handle and
     * terminates it; the turn fiber then settles the turn as interrupted.
     */
    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const target = yield* Effect.sync(() => {
          const ctx = sessions.get(threadId);
          if (!ctx || ctx.stopped) return undefined;
          const active = ctx.activeProcess;
          if (!active) return undefined;
          if (turnId !== undefined && active.turnId !== turnId) return undefined;
          ctx.interruptedTurnIds.add(active.turnId);
          return active;
        });
        if (!target) return;
        yield* offerRuntimeEvent({
          type: "turn.aborted",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId,
          turnId: target.turnId,
          payload: { reason: "interrupted" },
        });
        yield* target.terminate;
      });

    const respondToRequest: AntigravityAdapterShape["respondToRequest"] = (
      threadId,
      requestId: ApprovalRequestId,
    ) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "approval/respond",
          detail: `Antigravity runs headless and never opens approval requests, so '${requestId}' cannot be answered.`,
        });
      });

    const respondToUserInput: AntigravityAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
    ) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "user-input/respond",
          detail: `Antigravity runs headless and never opens user-input requests, so '${requestId}' cannot be answered.`,
        });
      });

    const readThread: AntigravityAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return { threadId, turns: ctx.turns };
      });

    const rollbackThread: AntigravityAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail: "The Antigravity CLI does not expose conversation rollback in headless mode.",
        });
      });

    const stopSession: AntigravityAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx || ctx.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        // Terminating first releases the turn fiber that holds the thread lock.
        yield* stopSessionInternal(ctx);
      });

    const listSessions: AntigravityAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));

    const hasSession: AntigravityAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return ctx !== undefined && !ctx.stopped;
      });

    const stopAll: AntigravityAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.ignore(stopAll()).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    return {
      provider: PROVIDER,
      // `--model` is accepted on every invocation, including one that resumes
      // an existing conversation.
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies AntigravityAdapterShape;
  });
}

function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? "";
}
