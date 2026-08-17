// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off
import {
  OPENCODE_GO_PROVIDER_ID,
  type ServerProviderRateLimitWindow,
  type ServerProviderRateLimits,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const OPENCODE_GO_USAGE_TIMEOUT_MS = 8_000;

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const MONTHLY_WINDOW_MINUTES = 30 * 24 * 60;

export interface OpenCodeGoUsageContext {
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
}

// The Go plan quota is reported as percent-used per window; the shared
// rate-limit schema speaks in remaining percent, hence the inversion.
function mapGoUsageWindow(
  raw: unknown,
  windowDurationMinutes: number,
): ServerProviderRateLimitWindow | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const window = raw as { percent?: unknown; resetsAt?: unknown };
  if (typeof window.percent !== "number" || !Number.isFinite(window.percent)) return undefined;
  const remainingPercent = Math.min(100, Math.max(0, Math.round(100 - window.percent)));
  const resetsAtMs = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : Number.NaN;
  return {
    remainingPercent,
    ...(Number.isFinite(resetsAtMs) ? { resetsAt: Math.floor(resetsAtMs / 1000) } : {}),
    windowDurationMinutes,
  };
}

export function normalizeOpenCodeGoUsage(payload: unknown): ServerProviderRateLimits | undefined {
  const usage = (payload as { usage?: unknown } | null | undefined)?.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const windows = usage as Record<string, unknown>;
  const fiveHour = mapGoUsageWindow(windows.rolling, FIVE_HOUR_WINDOW_MINUTES);
  const weekly = mapGoUsageWindow(windows.weekly, WEEKLY_WINDOW_MINUTES);
  const monthly = mapGoUsageWindow(windows.monthly, MONTHLY_WINDOW_MINUTES);
  if (fiveHour === undefined && weekly === undefined && monthly === undefined) return undefined;
  return {
    ...(fiveHour !== undefined ? { fiveHour } : {}),
    ...(weekly !== undefined ? { weekly } : {}),
    ...(monthly !== undefined ? { monthly } : {}),
  };
}

// opencode stores API keys under XDG data (macOS: Application Support) in
// `opencode/auth.json`, keyed by provider id.
export function resolveOpenCodeGoAuthFile(context: OpenCodeGoUsageContext): string {
  const base =
    context.platform === "darwin"
      ? NodePath.join(context.homeDir, "Library", "Application Support")
      : context.environment.XDG_DATA_HOME?.trim()
        ? context.environment.XDG_DATA_HOME
        : NodePath.join(context.homeDir, ".local", "share");
  return NodePath.join(base, "opencode", "auth.json");
}

export function parseOpenCodeGoApiKey(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entry = (parsed as Record<string, unknown> | null | undefined)?.[OPENCODE_GO_PROVIDER_ID];
  if (typeof entry !== "object" || entry === null) return undefined;
  const key = (entry as { type?: unknown; key?: unknown }).key;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : undefined;
}

const readGoApiKeyFromAuthFile = Effect.fn("OpenCodeProvider.readGoApiKeyFromAuthFile")(function* (
  context: OpenCodeGoUsageContext,
) {
  const exit = yield* Effect.exit(
    Effect.tryPromise({
      try: () => NodeFSP.readFile(resolveOpenCodeGoAuthFile(context), "utf8"),
      catch: () => undefined,
    }),
  );
  if (exit._tag === "Failure") return undefined;
  return parseOpenCodeGoApiKey(exit.value);
});

const fetchGoUsagePayload = Effect.fn("OpenCodeProvider.fetchGoUsagePayload")(function* (
  apiKey: string,
) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(OPENCODE_GO_USAGE_URL).pipe(
    HttpClientRequest.setHeader("authorization", `Bearer ${apiKey}`),
    HttpClientRequest.setHeader("accept", "application/json"),
  );
  const response = yield* client.execute(request).pipe(
    Effect.timeoutOption(OPENCODE_GO_USAGE_TIMEOUT_MS),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isNone(response)) return undefined;
  const httpResponse = response.value;
  if (httpResponse.status < 200 || httpResponse.status >= 300) return undefined;
  return yield* httpResponse.json.pipe(Effect.orElseSucceed(() => undefined));
});

// Best-effort quota probe: any failure (no key, no auth file, network,
// non-Go key) simply yields no rate limits instead of failing the provider
// status check.
export const loadOpenCodeGoUsage = Effect.fn("OpenCodeProvider.loadOpenCodeGoUsage")(function* (
  environment?: NodeJS.ProcessEnv,
) {
  const resolvedEnvironment = environment ?? (yield* HostProcessEnvironment);
  const platform = yield* HostProcessPlatform;
  const context: OpenCodeGoUsageContext = {
    environment: resolvedEnvironment,
    platform,
    homeDir:
      (platform === "win32"
        ? resolvedEnvironment.USERPROFILE?.trim() || resolvedEnvironment.HOME?.trim()
        : resolvedEnvironment.HOME?.trim()) || NodeOS.homedir(),
  };
  const fromEnvironment = context.environment.OPENCODE_API_KEY?.trim();
  const apiKey =
    fromEnvironment !== undefined && fromEnvironment.length > 0
      ? fromEnvironment
      : yield* readGoApiKeyFromAuthFile(context);
  if (apiKey === undefined) return undefined;
  const payload = yield* fetchGoUsagePayload(apiKey).pipe(Effect.provide(FetchHttpClient.layer));
  return normalizeOpenCodeGoUsage(payload);
});
