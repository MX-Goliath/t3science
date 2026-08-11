/**
 * antigravityStreamJson — pure decoding and classification for the Antigravity
 * CLI (`agy`) headless stream.
 *
 * `agy --print <prompt> --output-format stream-json` writes one JSON object per
 * line to stdout. Three envelopes exist today:
 *
 *   {"event":"init","conversation_id":"…","init":{…}}
 *   {"event":"step_update","step_update":{…}}
 *   {"event":"result","result":{…}}
 *
 * A step is the CLI's unit of work: one assistant response, one tool call, one
 * checkpoint, one error. Steps stream as repeated updates keyed by
 * `step_index`, with `state` moving `ACTIVE` → `DONE`/`ERROR`, and
 * `agent_response` steps carrying incremental `text_delta` chunks.
 *
 * Everything here is deliberately total: the CLI is a closed-source binary
 * that grows step types between releases, so decoding never fails on an
 * unknown shape — unknown steps degrade to a generic tool/assistant item
 * rather than killing the turn. The adapter owns all effectful concerns.
 *
 * @module provider/Layers/antigravityStreamJson
 */
import type {
  CanonicalItemType,
  RuntimeItemStatus,
  ThreadTokenUsageSnapshot,
  ToolLifecycleItemType,
} from "@t3tools/contracts";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const decodeUnknownJsonStringExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

/** Terminal statuses reported on `result.status`. */
export type AntigravityResultStatus = "SUCCESS" | "ERROR" | "CANCELLED" | "UNKNOWN";

export interface AntigravityUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly thinkingTokens?: number | undefined;
  readonly cacheReadTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export interface AntigravityToolError {
  readonly type?: string | undefined;
  readonly message?: string | undefined;
}

export interface AntigravityToolInfo {
  readonly name?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly output?: string | undefined;
  readonly error?: AntigravityToolError | undefined;
}

export interface AntigravityStepUpdate {
  readonly conversationId?: string | undefined;
  readonly stepIndex: number;
  /** `ACTIVE` | `DONE` | `ERROR` | anything a newer CLI adds. */
  readonly state: string;
  readonly stepType: string;
  readonly textDelta?: string | undefined;
  readonly toolName?: string | undefined;
  readonly toolInfo?: AntigravityToolInfo | undefined;
  readonly durationSeconds?: number | undefined;
  readonly usage?: AntigravityUsage | undefined;
}

export interface AntigravityInit {
  readonly conversationId?: string | undefined;
  readonly model?: string | undefined;
  readonly cwd?: string | undefined;
  readonly tools?: ReadonlyArray<string> | undefined;
  readonly permissionMode?: string | undefined;
}

export interface AntigravityResult {
  readonly conversationId?: string | undefined;
  readonly status: AntigravityResultStatus;
  readonly response?: string | undefined;
  readonly error?: string | undefined;
  readonly durationSeconds?: number | undefined;
  readonly numTurns?: number | undefined;
  readonly usage?: AntigravityUsage | undefined;
}

export type AntigravityStreamEvent =
  | { readonly _tag: "init"; readonly init: AntigravityInit; readonly raw: unknown }
  | { readonly _tag: "step"; readonly step: AntigravityStepUpdate; readonly raw: unknown }
  | { readonly _tag: "result"; readonly result: AntigravityResult; readonly raw: unknown }
  | { readonly _tag: "error"; readonly message: string; readonly raw: unknown }
  | { readonly _tag: "unknown"; readonly raw: unknown };

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Text fields keep their whitespace — deltas are concatenated verbatim. */
function readRawString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInt(
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!source) return undefined;
  const value = readNumber(source, key);
  if (value === undefined || value < 0) return undefined;
  return Math.floor(value);
}

function readUsage(source: Record<string, unknown> | undefined): AntigravityUsage | undefined {
  if (!source) return undefined;
  const raw = source.usage;
  if (!Predicate.isObject(raw)) return undefined;
  const usage: AntigravityUsage = {
    ...(readNonNegativeInt(raw, "input_tokens") !== undefined
      ? { inputTokens: readNonNegativeInt(raw, "input_tokens") }
      : {}),
    ...(readNonNegativeInt(raw, "output_tokens") !== undefined
      ? { outputTokens: readNonNegativeInt(raw, "output_tokens") }
      : {}),
    ...(readNonNegativeInt(raw, "thinking_tokens") !== undefined
      ? { thinkingTokens: readNonNegativeInt(raw, "thinking_tokens") }
      : {}),
    ...(readNonNegativeInt(raw, "cache_read_tokens") !== undefined
      ? { cacheReadTokens: readNonNegativeInt(raw, "cache_read_tokens") }
      : {}),
    ...(readNonNegativeInt(raw, "total_tokens") !== undefined
      ? { totalTokens: readNonNegativeInt(raw, "total_tokens") }
      : {}),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function readToolInfo(source: Record<string, unknown>): AntigravityToolInfo | undefined {
  const raw = source.tool_info;
  if (!Predicate.isObject(raw)) return undefined;
  const parameters = Predicate.isObject(raw.parameters) ? raw.parameters : undefined;
  const errorRaw = Predicate.isObject(raw.error) ? raw.error : undefined;
  const error: AntigravityToolError | undefined = errorRaw
    ? {
        ...(readString(errorRaw, "type") ? { type: readString(errorRaw, "type") } : {}),
        ...(readString(errorRaw, "message") ? { message: readString(errorRaw, "message") } : {}),
      }
    : undefined;
  return {
    ...(readString(raw, "name") ? { name: readString(raw, "name") } : {}),
    ...(parameters ? { parameters } : {}),
    ...(readRawString(raw, "output") !== undefined ? { output: readRawString(raw, "output") } : {}),
    ...(error && Object.keys(error).length > 0 ? { error } : {}),
  };
}

function readResultStatus(value: unknown): AntigravityResultStatus {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.trim().toUpperCase();
  if (normalized === "SUCCESS" || normalized === "ERROR" || normalized === "CANCELLED") {
    return normalized;
  }
  return "UNKNOWN";
}

/**
 * Decode one stdout line. Returns `undefined` for blank lines and for any
 * non-JSON noise the CLI prints around the stream (update notices, Go logging
 * that escaped the log file, …) so callers can log it without failing a turn.
 */
export function parseAntigravityStreamLine(line: string): AntigravityStreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) return undefined;
  const decoded = decodeUnknownJsonStringExit(trimmed);
  if (!Exit.isSuccess(decoded) || !Predicate.isObject(decoded.value)) return undefined;
  const parsed = decoded.value;
  return decodeAntigravityStreamEvent(parsed);
}

export function decodeAntigravityStreamEvent(
  payload: Record<string, unknown>,
): AntigravityStreamEvent {
  const event = readString(payload, "event");
  const topLevelConversationId = readString(payload, "conversation_id");

  if (event === "init") {
    const initRaw = Predicate.isObject(payload.init) ? payload.init : {};
    const tools = Array.isArray(initRaw.tools)
      ? initRaw.tools.filter((tool): tool is string => typeof tool === "string")
      : undefined;
    return {
      _tag: "init",
      init: {
        ...((topLevelConversationId ?? readString(initRaw, "conversation_id"))
          ? {
              conversationId: topLevelConversationId ?? readString(initRaw, "conversation_id"),
            }
          : {}),
        ...(readString(initRaw, "model") ? { model: readString(initRaw, "model") } : {}),
        ...(readString(initRaw, "cwd") ? { cwd: readString(initRaw, "cwd") } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(readString(initRaw, "permission_mode")
          ? { permissionMode: readString(initRaw, "permission_mode") }
          : {}),
      },
      raw: payload,
    };
  }

  if (event === "step_update") {
    const stepRaw = Predicate.isObject(payload.step_update) ? payload.step_update : undefined;
    if (!stepRaw) return { _tag: "unknown", raw: payload };
    const stepIndex = readNumber(stepRaw, "step_index") ?? 0;
    const toolInfo = readToolInfo(stepRaw);
    const usage = readUsage(stepRaw);
    return {
      _tag: "step",
      step: {
        ...((readString(stepRaw, "conversation_id") ?? topLevelConversationId)
          ? {
              conversationId: readString(stepRaw, "conversation_id") ?? topLevelConversationId,
            }
          : {}),
        stepIndex: Math.max(0, Math.floor(stepIndex)),
        state: readString(stepRaw, "state") ?? "ACTIVE",
        stepType: readString(stepRaw, "step_type") ?? "unknown",
        ...(readRawString(stepRaw, "text_delta") !== undefined
          ? { textDelta: readRawString(stepRaw, "text_delta") }
          : {}),
        ...(readString(stepRaw, "tool_name") ? { toolName: readString(stepRaw, "tool_name") } : {}),
        ...(toolInfo && Object.keys(toolInfo).length > 0 ? { toolInfo } : {}),
        ...(readNumber(stepRaw, "duration_seconds") !== undefined
          ? { durationSeconds: readNumber(stepRaw, "duration_seconds") }
          : {}),
        ...(usage ? { usage } : {}),
      },
      raw: payload,
    };
  }

  if (event === "result") {
    const resultRaw = Predicate.isObject(payload.result) ? payload.result : {};
    const usage = readUsage(resultRaw);
    return {
      _tag: "result",
      result: {
        ...((topLevelConversationId ?? readString(resultRaw, "conversation_id"))
          ? {
              conversationId: topLevelConversationId ?? readString(resultRaw, "conversation_id"),
            }
          : {}),
        status: readResultStatus(resultRaw.status),
        ...(readRawString(resultRaw, "response") !== undefined
          ? { response: readRawString(resultRaw, "response") }
          : {}),
        ...(readString(resultRaw, "error") ? { error: readString(resultRaw, "error") } : {}),
        ...(readNumber(resultRaw, "duration_seconds") !== undefined
          ? { durationSeconds: readNumber(resultRaw, "duration_seconds") }
          : {}),
        ...(readNumber(resultRaw, "num_turns") !== undefined
          ? { numTurns: readNumber(resultRaw, "num_turns") }
          : {}),
        ...(usage ? { usage } : {}),
      },
      raw: payload,
    };
  }

  if (event === "error") {
    const message =
      readString(payload, "error") ??
      readString(payload, "message") ??
      (Predicate.isObject(payload.error) ? readString(payload.error, "message") : undefined);
    return { _tag: "error", message: message ?? "Antigravity reported an error.", raw: payload };
  }

  return { _tag: "unknown", raw: payload };
}

// ── Step classification ───────────────────────────────────────────────

/** Steps whose only job is CLI bookkeeping; they never reach the timeline. */
const SILENT_STEP_TYPES: ReadonlySet<string> = new Set(["user_input", "checkpoint", "unknown"]);

export function isSilentAntigravityStep(step: AntigravityStepUpdate): boolean {
  if (step.stepType === "tool" || step.toolName !== undefined) return false;
  return SILENT_STEP_TYPES.has(step.stepType);
}

export type AntigravityStepKind = "assistant" | "reasoning" | "tool" | "error" | "silent";

export function antigravityStepKind(step: AntigravityStepUpdate): AntigravityStepKind {
  if (step.stepType === "tool" || step.toolName !== undefined) return "tool";
  switch (step.stepType) {
    case "agent_response":
    case "system_message":
      return "assistant";
    case "thinking":
    case "thought":
    case "raw_thought":
      return "reasoning";
    case "error_message":
      return "error";
    default:
      return isSilentAntigravityStep(step) ? "silent" : "assistant";
  }
}

const COMMAND_TOOLS: ReadonlySet<string> = new Set([
  "run_command",
  "command_status",
  "send_command_input",
]);

const FILE_CHANGE_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "sed_file",
  "notebook_edit",
]);

const WEB_TOOLS: ReadonlySet<string> = new Set([
  "search_web",
  "read_url_content",
  "moma_search",
  "code_search",
]);

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set([
  "invoke_subagent",
  "browser_subagent",
  "define_subagent",
  "manage_subagents",
]);

const IMAGE_TOOLS: ReadonlySet<string> = new Set(["capture_browser_screenshot", "generate_image"]);

/**
 * Map an `agy` tool name onto the canonical item type clients render with.
 * Unknown tools land on `dynamic_tool_call`, which renders as a generic tool
 * row — the safe default as the CLI's tool catalog grows.
 */
export function canonicalItemTypeForAntigravityTool(
  toolName: string | undefined,
): ToolLifecycleItemType {
  if (!toolName) return "dynamic_tool_call";
  if (COMMAND_TOOLS.has(toolName)) return "command_execution";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file_change";
  if (WEB_TOOLS.has(toolName)) return "web_search";
  if (IMAGE_TOOLS.has(toolName)) return "image_view";
  if (toolName === "call_mcp_tool") return "mcp_tool_call";
  if (SUBAGENT_TOOLS.has(toolName)) return "collab_agent_tool_call";
  return "dynamic_tool_call";
}

export function isAntigravitySubagentTool(toolName: string | undefined): boolean {
  return toolName !== undefined && SUBAGENT_TOOLS.has(toolName);
}

export function canonicalItemTypeForAntigravityStep(
  step: AntigravityStepUpdate,
): CanonicalItemType {
  switch (antigravityStepKind(step)) {
    case "tool":
      return canonicalItemTypeForAntigravityTool(step.toolName ?? step.toolInfo?.name);
    case "reasoning":
      return "reasoning";
    case "error":
      return "error";
    default:
      return "assistant_message";
  }
}

export function runtimeItemStatusForAntigravityStep(
  step: AntigravityStepUpdate,
): RuntimeItemStatus {
  const state = step.state.trim().toUpperCase();
  if (state === "ERROR" || state === "FAILED") {
    return isAntigravityPermissionDenial(step) ? "declined" : "failed";
  }
  if (state === "DONE" || state === "COMPLETED") return "completed";
  return "inProgress";
}

/**
 * Headless `agy` cannot prompt, so any tool that needed approval comes back as
 * a tool error with a "denied permission" message rather than as an approval
 * request. Detect it so the timeline can show a declined row (and the adapter
 * can explain the permission mode once per turn) instead of a hard failure.
 */
export function isAntigravityPermissionDenial(step: AntigravityStepUpdate): boolean {
  const message = step.toolInfo?.error?.message;
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("denied permission") ||
    normalized.includes("user denied") ||
    normalized.includes("auto-denied") ||
    normalized.includes("permission was denied")
  );
}

const PATH_PARAMETER_KEYS = [
  "TargetFile",
  "AbsolutePath",
  "FilePath",
  "DirectoryPath",
  "NotebookPath",
  "File",
  "Path",
] as const;

function firstStringParameter(
  parameters: Record<string, unknown> | undefined,
  keys: ReadonlyArray<string>,
): string | undefined {
  if (!parameters) return undefined;
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Single-line label for a tool row (e.g. `run_command · ls -la`). */
export function antigravityToolTitle(step: AntigravityStepUpdate): string {
  const toolName = step.toolName ?? step.toolInfo?.name ?? "tool";
  const parameters = step.toolInfo?.parameters;
  const command = firstStringParameter(parameters, ["CommandLine", "Command", "command"]);
  if (command) return command;
  const query = firstStringParameter(parameters, ["Query", "query", "SearchTerm", "Url", "url"]);
  if (query) return `${toolName}: ${query}`;
  const targetPath = firstStringParameter(parameters, PATH_PARAMETER_KEYS);
  if (targetPath) return `${toolName}: ${targetPath}`;
  return toolName;
}

export interface AntigravityToolItemData {
  readonly toolName: string;
  readonly parameters?: Record<string, unknown>;
  readonly output?: string;
  readonly error?: AntigravityToolError;
  readonly durationSeconds?: number;
  readonly path?: string;
  readonly command?: string;
}

export function antigravityToolItemData(step: AntigravityStepUpdate): AntigravityToolItemData {
  const parameters = step.toolInfo?.parameters;
  const command = firstStringParameter(parameters, ["CommandLine", "Command", "command"]);
  const path = firstStringParameter(parameters, PATH_PARAMETER_KEYS);
  return {
    toolName: step.toolName ?? step.toolInfo?.name ?? "tool",
    ...(parameters ? { parameters } : {}),
    ...(step.toolInfo?.output !== undefined ? { output: step.toolInfo.output } : {}),
    ...(step.toolInfo?.error ? { error: step.toolInfo.error } : {}),
    ...(step.durationSeconds !== undefined ? { durationSeconds: step.durationSeconds } : {}),
    ...(path ? { path } : {}),
    ...(command ? { command } : {}),
  };
}

// ── Usage ─────────────────────────────────────────────────────────────

/**
 * Running token accounting for one Antigravity conversation.
 *
 * `agy` reports per-step counters, not a conversation total: `input_tokens` is
 * the uncached prompt for that step and `cache_read_tokens` the part served
 * from cache, so the live context size is their sum on the most recent step.
 * Output tokens accumulate across the turn.
 */
export interface AntigravityUsageAccumulator {
  readonly totalOutputTokens: number;
  readonly totalThinkingTokens: number;
  readonly lastInputTokens: number;
  readonly lastCachedInputTokens: number;
  readonly lastOutputTokens: number;
  readonly lastReasoningOutputTokens: number;
  readonly toolUses: number;
  readonly durationMs: number;
}

export const emptyAntigravityUsageAccumulator: AntigravityUsageAccumulator = {
  totalOutputTokens: 0,
  totalThinkingTokens: 0,
  lastInputTokens: 0,
  lastCachedInputTokens: 0,
  lastOutputTokens: 0,
  lastReasoningOutputTokens: 0,
  toolUses: 0,
  durationMs: 0,
};

export function accumulateAntigravityUsage(
  accumulator: AntigravityUsageAccumulator,
  usage: AntigravityUsage | undefined,
): AntigravityUsageAccumulator {
  if (!usage) return accumulator;
  const outputTokens = usage.outputTokens ?? 0;
  const thinkingTokens = usage.thinkingTokens ?? 0;
  return {
    ...accumulator,
    totalOutputTokens: accumulator.totalOutputTokens + outputTokens,
    totalThinkingTokens: accumulator.totalThinkingTokens + thinkingTokens,
    lastInputTokens: usage.inputTokens ?? accumulator.lastInputTokens,
    lastCachedInputTokens: usage.cacheReadTokens ?? accumulator.lastCachedInputTokens,
    lastOutputTokens: outputTokens,
    lastReasoningOutputTokens: thinkingTokens,
  };
}

export function antigravityUsageSnapshot(
  accumulator: AntigravityUsageAccumulator,
  options?: { readonly maxTokens?: number | undefined },
): ThreadTokenUsageSnapshot {
  const contextTokens = accumulator.lastInputTokens + accumulator.lastCachedInputTokens;
  const usedTokens = contextTokens + accumulator.lastOutputTokens;
  return {
    usedTokens,
    totalProcessedTokens: contextTokens + accumulator.totalOutputTokens,
    ...(options?.maxTokens !== undefined && options.maxTokens > 0
      ? { maxTokens: options.maxTokens }
      : {}),
    inputTokens: accumulator.lastInputTokens,
    cachedInputTokens: accumulator.lastCachedInputTokens,
    outputTokens: accumulator.totalOutputTokens,
    reasoningOutputTokens: accumulator.totalThinkingTokens,
    lastUsedTokens: usedTokens,
    lastInputTokens: accumulator.lastInputTokens,
    lastCachedInputTokens: accumulator.lastCachedInputTokens,
    lastOutputTokens: accumulator.lastOutputTokens,
    lastReasoningOutputTokens: accumulator.lastReasoningOutputTokens,
    ...(accumulator.toolUses > 0 ? { toolUses: accumulator.toolUses } : {}),
    ...(accumulator.durationMs > 0 ? { durationMs: accumulator.durationMs } : {}),
    compactsAutomatically: true,
  };
}
