// @effect-diagnostics nodeBuiltinImport:off - Credential path resolution is also tested without an Effect runtime.
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

const AuthFile = Schema.Struct({ "opencode-go": Schema.optionalKey(Schema.Unknown) });
const ApiAuth = Schema.Struct({ type: Schema.Literal("api"), key: Schema.String });
const decodeAuthFile = Schema.decodeEffect(Schema.fromJsonString(AuthFile));
const decodeAuthFileOption = Schema.decodeOption(Schema.fromJsonString(AuthFile));
const decodeApiAuth = Schema.decodeUnknownOption(ApiAuth);
const UsageWindow = Schema.Struct({
  percent: Schema.Finite,
  resetsAt: Schema.optionalKey(Schema.Unknown),
});
const UsageResponse = Schema.Struct({
  usage: Schema.Record(Schema.String, Schema.Unknown),
});
const decodeUsageResponse = Schema.decodeUnknownOption(UsageResponse);
const decodeUsageWindow = Schema.decodeUnknownOption(UsageWindow);
const decodeResetTime = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);
const GO_WINDOWS = [
  { key: "rolling", id: "go_rolling", kind: "session", label: "Go · Session", minutes: 5 * 60 },
  { key: "weekly", id: "go_weekly", kind: "weekly", label: "Go · Weekly", minutes: 7 * 24 * 60 },
  {
    key: "monthly",
    id: "go_monthly",
    kind: "monthly",
    label: "Go · Monthly",
    minutes: 30 * 24 * 60,
  },
] as const;

/** Keep valid quota windows even when another window or its reset time is absent. */
export function normalizeOpenCodeGoUsage(
  payload: unknown,
  checkedAt = "1970-01-01T00:00:00.000Z",
): ServerProviderUsageLimits | undefined {
  const body = decodeUsageResponse(payload);
  if (Option.isNone(body)) return undefined;
  const windows: ServerProviderUsageWindow[] = [];
  for (const definition of GO_WINDOWS) {
    const window = decodeUsageWindow(body.value.usage[definition.key]);
    if (Option.isNone(window)) continue;
    const reset = decodeResetTime(window.value.resetsAt);
    windows.push({
      id: definition.id,
      kind: definition.kind,
      label: definition.label,
      windowDurationMins: definition.minutes,
      usedPercent: clampPercent(window.value.percent),
      ...(Option.isSome(reset) ? { resetsAt: DateTime.formatIso(reset.value) } : {}),
    });
  }
  return windows.length > 0 ? makeUsageLimits({ checkedAt, windows }) : undefined;
}

export function resolveOpenCodeGoAuthFile(context: {
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
}): string {
  const dataHome =
    context.environment.XDG_DATA_HOME?.trim() ||
    (context.platform === "darwin"
      ? NodePath.join(context.homeDir, "Library", "Application Support")
      : NodePath.join(context.homeDir, ".local", "share"));
  return NodePath.join(dataHome, "opencode", "auth.json");
}

export function parseOpenCodeGoApiKey(raw: string): string | undefined {
  const auth = decodeAuthFileOption(raw);
  if (Option.isNone(auth)) return undefined;
  const entry = decodeApiAuth(auth.value["opencode-go"]);
  return Option.isSome(entry) ? entry.value.key.trim() || undefined : undefined;
}

/** External OpenCode servers own their credentials; never read the host's account for them. */
export const readOpenCodeGoUsageLimits = Effect.fn("readOpenCodeGoUsageLimits")(function* (input: {
  readonly enabled: boolean;
  readonly serverUrl: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const unsupported = makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
  const failed = makeUnavailableUsageLimits({
    checkedAt,
    reason: "probeFailed",
    message: "OpenCode Go could not read usage.",
  });
  if (!input.enabled || input.serverUrl.trim()) return unsupported;

  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const platform = yield* HostProcessPlatform;
    const env = input.environment;
    const authPath = resolveOpenCodeGoAuthFile({
      environment: env,
      platform,
      homeDir: (platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME) || NodeOS.homedir(),
    });
    const contents =
      env.OPENCODE_AUTH_CONTENT ||
      (yield* fs.readFileString(authPath).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
        }),
      ));
    const auth = yield* decodeAuthFile(contents);
    const apiAuth = decodeApiAuth(auth["opencode-go"]);
    // OpenCode overlays stored API credentials after environment credentials.
    const apiKey = (Option.isSome(apiAuth) ? apiAuth.value.key : env.OPENCODE_API_KEY)?.trim();
    if (!apiKey) return unsupported;

    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get("https://opencode.ai/zen/go/v1/usage").pipe(
        HttpClientRequest.bearerToken(apiKey),
      ),
    );
    // A valid Zen key can exist without a Go subscription.
    if (response.status === 403) return unsupported;
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((response) => response.json),
    );
    const limits = normalizeOpenCodeGoUsage(body, checkedAt);
    if (!limits) return failed;
    return {
      ...limits,
      // Go's usage response has no account ID. An unkeyed hash matches across
      // environments without a shared secret. It permits offline guesses, but
      // Go keys are randomly generated.
      credentialFingerprint: NodeCrypto.createHash("sha256")
        .update("opencode-go\0")
        .update(apiKey)
        .digest("hex"),
    };
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => failed),
  );
});
