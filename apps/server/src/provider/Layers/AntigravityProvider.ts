/**
 * AntigravityProvider — health probe and snapshot for the Antigravity CLI
 * (`agy`).
 *
 * Everything the snapshot needs is available from short, local CLI calls:
 *
 *   agy --version                          → installed + version
 *   agy models                             → model catalog + auth status
 *   agy --print /skills --output-format json → skills
 *   agy --print /usage  --output-format json → plan limits
 *
 * The print-mode commands are resolved by the CLI itself (`num_turns: 0`), so
 * probing never spends model quota.
 *
 * @module provider/Layers/AntigravityProvider
 */
import {
  type AntigravitySettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderModel,
  type ServerProviderRateLimits,
  type ServerProviderRateLimitWindow,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { buildAntigravityCommandArgs } from "./antigravityLaunchArgs.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const decodeUnknownJsonStringExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Early Access",
  // `--mode plan` is a first-class CLI mode, so the composer's plan toggle
  // maps onto a real capability.
  showInteractionModeToggle: true,
} as const;

const ANTIGRAVITY_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "effort",
      label: "Reasoning",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    }),
  ],
});

const VERSION_PROBE_TIMEOUT_MS = 6_000;
// A cold `agy models`/print-mode invocation starts the language server and can
// take around 30 seconds even though the same command is fast once warmed up.
// Keep health discovery comfortably above that cold-start cost.
const MODELS_PROBE_TIMEOUT_MS = 60_000;
const COMMAND_PROBE_TIMEOUT_MS = 60_000;

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

/**
 * Catalog fallback used before the first successful `agy models` call and when
 * the CLI cannot reach the model service. Kept deliberately small: the live
 * catalog is authoritative and account-specific.
 */
export const ANTIGRAVITY_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", isCustom: false, isDefault: true },
  { slug: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", isCustom: false },
  { slug: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", isCustom: false },
  { slug: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", isCustom: false },
].map((model) => ({
  ...model,
  subProvider: subProviderForAntigravityModel(model.slug),
  capabilities: ANTIGRAVITY_MODEL_CAPABILITIES,
}));

/**
 * Slash commands `agy` resolves locally in print mode. Anything else typed
 * with a leading slash is expanded as a skill or sent to the model, exactly as
 * in the CLI.
 */
export const ANTIGRAVITY_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  { name: "usage", description: "Show remaining plan limits." },
  { name: "model", description: "Show the model the CLI is currently configured with." },
  { name: "effort", description: "Show the reasoning effort for the current model." },
  { name: "credits", description: "Show remaining credits." },
  { name: "agents", description: "List configured agents." },
  { name: "skills", description: "List available skills." },
];

export function subProviderForAntigravityModel(slug: string): string | undefined {
  const normalized = slug.toLowerCase();
  if (normalized.startsWith("gemini")) return "Google";
  if (normalized.startsWith("claude")) return "Anthropic";
  if (normalized.startsWith("gpt")) return "OpenAI";
  return undefined;
}

function antigravityModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = ANTIGRAVITY_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    customModels ?? [],
    ANTIGRAVITY_MODEL_CAPABILITIES,
  );
}

/**
 * `agy models` prints one `<slug>\t<label>` row per model on stdout; progress
 * spinners go to stderr.
 */
export function parseAntigravityModelList(stdout: string): ReadonlyArray<ServerProviderModel> {
  const models: Array<ServerProviderModel> = [];
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("Usage:")) continue;
    const [rawSlug, ...rest] = trimmed.split("\t");
    const slug = rawSlug?.trim();
    if (!slug || slug.includes(" ") || seen.has(slug)) continue;
    seen.add(slug);
    const name = rest.join("\t").trim() || slug;
    const subProvider = subProviderForAntigravityModel(slug);
    models.push({
      slug,
      name,
      isCustom: false,
      ...(subProvider ? { subProvider } : {}),
      capabilities: ANTIGRAVITY_MODEL_CAPABILITIES,
    });
  }
  return models;
}

/** The CLI says this when the account has no usable session. */
export function isAntigravitySignedOutOutput(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("please sign in") ||
    normalized.includes("not signed in") ||
    normalized.includes("no authentication methods available")
  );
}

interface AntigravityUsageBucket {
  readonly id?: string;
  readonly window?: string;
  readonly remainingFraction?: number;
  readonly resetTime?: string;
}

interface AntigravityUsageGroup {
  readonly name?: string;
  readonly buckets: ReadonlyArray<AntigravityUsageBucket>;
}

function parseUsageGroups(data: unknown): ReadonlyArray<AntigravityUsageGroup> {
  if (!Predicate.isObject(data) || !Array.isArray(data.groups)) return [];
  return data.groups.filter(Predicate.isObject).map((group) => ({
    ...(typeof group.name === "string" ? { name: group.name } : {}),
    buckets: Array.isArray(group.buckets)
      ? group.buckets.filter(Predicate.isObject).map((bucket) => ({
          ...(typeof bucket.id === "string" ? { id: bucket.id } : {}),
          ...(typeof bucket.window === "string" ? { window: bucket.window } : {}),
          ...(typeof bucket.remaining_fraction === "number"
            ? { remainingFraction: bucket.remaining_fraction }
            : {}),
          ...(typeof bucket.reset_time === "string" ? { resetTime: bucket.reset_time } : {}),
        }))
      : [],
  }));
}

function mapUsageBucket(
  bucket: AntigravityUsageBucket | undefined,
  windowDurationMinutes: number,
): ServerProviderRateLimitWindow | undefined {
  if (!bucket || typeof bucket.remainingFraction !== "number") return undefined;
  const remainingPercent = Math.round(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100);
  const resetsAtMs = bucket.resetTime ? Date.parse(bucket.resetTime) : Number.NaN;
  const resetsAt =
    Number.isFinite(resetsAtMs) && resetsAtMs > 0 ? Math.floor(resetsAtMs / 1_000) : undefined;
  return {
    remainingPercent,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    windowDurationMinutes,
  };
}

/**
 * `/usage` reports one bucket group per model family (Gemini vs the
 * third-party Claude/GPT pool). The composer shows a single meter, so the
 * group is picked from the model the thread would run — falling back to the
 * pool with the least headroom, which is the one about to bite.
 */
export function normalizeAntigravityRateLimits(
  data: unknown,
  options?: { readonly model?: string | undefined },
): ServerProviderRateLimits | undefined {
  const groups = parseUsageGroups(data);
  if (groups.length === 0) return undefined;

  const isGeminiModel = (options?.model ?? "").toLowerCase().startsWith("gemini");
  const geminiGroup = groups.find((group) =>
    group.buckets.some((bucket) => bucket.id?.startsWith("gemini")),
  );
  const thirdPartyGroup = groups.find((group) =>
    group.buckets.some((bucket) => bucket.id?.startsWith("3p")),
  );

  const remainingFor = (group: AntigravityUsageGroup | undefined): number =>
    group === undefined
      ? Number.POSITIVE_INFINITY
      : Math.min(
          ...group.buckets.map((bucket) => bucket.remainingFraction ?? Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY,
        );

  const selected =
    options?.model === undefined
      ? remainingFor(geminiGroup) <= remainingFor(thirdPartyGroup)
        ? geminiGroup
        : thirdPartyGroup
      : isGeminiModel
        ? geminiGroup
        : thirdPartyGroup;
  const group = selected ?? groups[0];
  if (!group) return undefined;

  const fiveHour = mapUsageBucket(
    group.buckets.find((bucket) => bucket.window === "5h"),
    FIVE_HOUR_WINDOW_MINUTES,
  );
  const weekly = mapUsageBucket(
    group.buckets.find((bucket) => bucket.window === "weekly"),
    WEEKLY_WINDOW_MINUTES,
  );
  if (!fiveHour && !weekly) return undefined;
  return {
    ...(fiveHour ? { fiveHour } : {}),
    ...(weekly ? { weekly } : {}),
  };
}

export function parseAntigravitySkills(data: unknown): ReadonlyArray<ServerProviderSkill> {
  if (!Predicate.isObject(data) || !Array.isArray(data.skills)) return [];
  return data.skills
    .filter(Predicate.isObject)
    .flatMap((skill): ReadonlyArray<ServerProviderSkill> => {
      const name = typeof skill.name === "string" ? skill.name.trim() : "";
      const path = typeof skill.path === "string" ? skill.path.trim() : "";
      if (name.length === 0 || path.length === 0) return [];
      const description = typeof skill.description === "string" ? skill.description.trim() : "";
      return [
        {
          name,
          path,
          enabled: true,
          ...(description.length > 0 ? { description } : {}),
          ...(skill.builtin === true ? { scope: "builtin" } : {}),
        },
      ];
    });
}

/**
 * Extract the structured payload of a print-mode command result
 * (`{"command":{"name":"usage","data":{…}}}`).
 */
export function parseAntigravityCommandData(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return undefined;
  const decoded = decodeUnknownJsonStringExit(trimmed);
  if (!Exit.isSuccess(decoded)) return undefined;
  const parsed = decoded.value;
  if (!Predicate.isObject(parsed) || !Predicate.isObject(parsed.command)) return undefined;
  return parsed.command.data;
}

const runAntigravityCommand = (input: {
  readonly settings: AntigravitySettings;
  readonly args: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
}) =>
  Effect.gen(function* () {
    const command = input.settings.binaryPath || "agy";
    const spawnCommand = yield* resolveSpawnCommand(command, [...input.args], {
      env: input.environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: input.environment,
        shell: spawnCommand.shell,
        // `agy` keeps non-interactive commands alive while stdin is an open
        // pipe. Health probes never write to it, so connect it to EOF.
        stdin: "ignore",
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }),
    );
  });

const runAntigravityPrintCommand = (input: {
  readonly settings: AntigravitySettings;
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
}) =>
  runAntigravityCommand({
    settings: input.settings,
    args: buildAntigravityCommandArgs(input.command),
    environment: input.environment,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  }).pipe(
    Effect.timeoutOption(COMMAND_PROBE_TIMEOUT_MS),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined),
    Effect.map((result: CommandResult | undefined) =>
      result === undefined ? undefined : parseAntigravityCommandData(result.stdout),
    ),
  );

/** Read plan limits without running a model turn. */
export const probeAntigravityRateLimits = (input: {
  readonly settings: AntigravitySettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
  readonly model?: string | undefined;
}): Effect.Effect<
  ServerProviderRateLimits | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  runAntigravityPrintCommand({
    settings: input.settings,
    command: "/usage",
    environment: input.environment,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  }).pipe(
    Effect.map((data) =>
      normalizeAntigravityRateLimits(data, input.model ? { model: input.model } : {}),
    ),
  );

/**
 * Best-effort account label. The CLI keeps the signed-in Google account in its
 * shared config directory; absence is normal and never downgrades the probe.
 */
const readAntigravityAccountEmail = (
  environment: NodeJS.ProcessEnv,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const home = environment.HOME ?? environment.USERPROFILE;
    if (!home) return undefined;
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem
      .readFileString(`${home}/.gemini/google_accounts.json`)
      .pipe(Effect.orElseSucceed(() => ""));
    if (raw.trim().length === 0) return undefined;
    const decoded = decodeUnknownJsonStringExit(raw);
    if (!Exit.isSuccess(decoded)) return undefined;
    const parsed = decoded.value;
    if (
      Predicate.isObject(parsed) &&
      typeof parsed.active === "string" &&
      parsed.active.includes("@")
    ) {
      return parsed.active.trim();
    }
    return undefined;
  });

export function buildInitialAntigravityProviderSnapshot(
  settings: AntigravitySettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = antigravityModelsFromSettings(settings.customModels);

    if (!settings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Antigravity CLI availability...",
      },
    });
  });
}

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    settings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
    cwd?: string,
    resolveRateLimits?: () => Effect.Effect<ServerProviderRateLimits | undefined>,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const fallbackModels = antigravityModelsFromSettings(settings.customModels);

    if (!settings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    const versionResult = yield* runAntigravityCommand({
      settings,
      args: ["--version"],
      environment,
      ...(cwd ? { cwd } : {}),
    }).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

    if (Result.isFailure(versionResult)) {
      const error = versionResult.failure;
      yield* Effect.logWarning("Antigravity CLI health check failed.", {
        errorTag: error._tag,
      });
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Antigravity CLI (`agy`) is not installed or not on PATH."
            : "Failed to execute the Antigravity CLI health check.",
        },
      });
    }

    if (Option.isNone(versionResult.success)) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Antigravity CLI is installed but timed out while running `agy --version`.",
        },
      });
    }

    const versionOutput = versionResult.success.value;
    const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
    if (versionOutput.code !== 0) {
      yield* Effect.logWarning("Antigravity CLI version probe exited with a non-zero status.", {
        exitCode: versionOutput.code,
        stdoutLength: versionOutput.stdout.length,
        stderrLength: versionOutput.stderr.length,
      });
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: "Antigravity CLI is installed but failed to run.",
        },
      });
    }

    const modelsResult = yield* runAntigravityCommand({
      settings,
      args: ["models"],
      environment,
      ...(cwd ? { cwd } : {}),
    }).pipe(Effect.timeoutOption(MODELS_PROBE_TIMEOUT_MS), Effect.result);

    const modelsOutput = Result.isSuccess(modelsResult)
      ? Option.getOrUndefined(modelsResult.success)
      : undefined;
    const discoveredModels = modelsOutput ? parseAntigravityModelList(modelsOutput.stdout) : [];
    const signedOut =
      modelsOutput !== undefined &&
      discoveredModels.length === 0 &&
      isAntigravitySignedOutOutput(`${modelsOutput.stdout}\n${modelsOutput.stderr}`);

    if (signedOut) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version,
          status: "warning",
          auth: { status: "unauthenticated" },
          message: "Sign in with `agy` to use Antigravity.",
        },
      });
    }

    if (discoveredModels.length === 0) {
      const modelsTimedOut = Result.isSuccess(modelsResult) && Option.isNone(modelsResult.success);
      const modelsFailed = Result.isFailure(modelsResult);
      yield* Effect.logWarning(
        modelsTimedOut
          ? "Antigravity model discovery timed out."
          : modelsFailed
            ? "Antigravity model discovery failed."
            : "Antigravity model discovery returned no models.",
        { exitCode: modelsOutput?.code },
      );
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version,
          status: "warning",
          auth: { status: "unknown" },
          message: modelsTimedOut
            ? "Antigravity CLI is installed but `agy models` timed out during its cold start."
            : modelsFailed
              ? "Antigravity CLI is installed but T3 Code could not run `agy models`."
              : "Antigravity CLI is installed but `agy models` returned no models.",
        },
      });
    }

    const email = yield* readAntigravityAccountEmail(environment);
    const auth: ServerProviderAuth = {
      status: "authenticated",
      type: "google",
      label: "Google account",
      ...(email ? { email } : {}),
    };

    const skillsData = yield* runAntigravityPrintCommand({
      settings,
      command: "/skills",
      environment,
      ...(cwd ? { cwd } : {}),
    });
    const rateLimits = settings.showRateLimits
      ? resolveRateLimits
        ? yield* resolveRateLimits().pipe(Effect.orElseSucceed(() => undefined))
        : yield* probeAntigravityRateLimits({
            settings,
            environment,
            ...(cwd ? { cwd } : {}),
          })
      : undefined;

    const snapshot = buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models: antigravityModelsFromSettings(
        settings.customModels,
        withDefaultModel(discoveredModels),
      ),
      slashCommands: ANTIGRAVITY_SLASH_COMMANDS,
      skills: parseAntigravitySkills(skillsData),
      probe: {
        installed: true,
        version,
        status: "ready",
        auth,
      },
    });

    return rateLimits ? { ...snapshot, rateLimits } : snapshot;
  },
);

/**
 * Mark the CLI's own preferred model as default so a fresh thread starts on
 * the same model the terminal would use. `agy models` lists Gemini Pro first.
 */
function withDefaultModel(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  if (models.length === 0 || models.some((model) => model.isDefault)) return models;
  const preferred =
    models.find((model) => model.slug === "gemini-3.1-pro-high") ??
    models.find((model) => model.slug.startsWith("gemini") && model.slug.includes("pro")) ??
    models[0];
  return models.map((model) => (model === preferred ? { ...model, isDefault: true } : model));
}

export const enrichAntigravitySnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => input.publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Antigravity version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
