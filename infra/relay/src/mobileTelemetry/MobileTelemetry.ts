import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { RelayApi, type RelayMobileTelemetrySignal } from "@t3tools/contracts/relay";

import type { SourceMapMiss } from "./otlpLogs.ts";
import { decodeSourceMap, type CompactSourceMap } from "./sourceMap.ts";

/** Observe splits batches the endpoint answers 413 for, so this only bounds one request. */
export const MOBILE_TELEMETRY_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Per client IP. An app flushes a few batches per launch and background. */
export const MOBILE_TELEMETRY_RATE_LIMIT = { limit: 120, periodSeconds: 60 } as const;
/** A decoded production map is about 20 MB; two fit an isolate and cover iOS and Android. */
const SOURCE_MAP_CACHE_CAPACITY = 2;
/** Our iOS map is about 12 MB once uploads drop what the relay never reads; larger is skipped unread. */
const MAX_SOURCE_MAP_BYTES = 16 * 1024 * 1024;
/** A map can land in R2 a moment after its update ships, so a miss is retried. */
const MISSING_SOURCE_MAP_TTL = Duration.minutes(5);
const FAILED_SOURCE_MAP_TTL = Duration.seconds(30);

const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownOption(UnknownFromJsonString);
const parseJson = (text: string): unknown => Option.getOrUndefined(decodeJson(text));

interface AxiomDestination {
  /** Axiom's OTLP/HTTP endpoint for the signal, such as `.../v1/logs`. */
  readonly url: string;
  readonly dataset: string;
}

export class MobileTelemetrySettings extends Context.Service<
  MobileTelemetrySettings,
  {
    readonly axiomToken: Redacted.Redacted<string>;
    readonly destinations: Readonly<Record<RelayMobileTelemetrySignal, AxiomDestination>>;
  }
>()("t3code-relay/mobileTelemetry/MobileTelemetry/MobileTelemetrySettings") {}

export class MobileTelemetryRateLimiter extends Context.Service<
  MobileTelemetryRateLimiter,
  { readonly allow: (key: string) => Effect.Effect<boolean> }
>()("t3code-relay/mobileTelemetry/MobileTelemetry/MobileTelemetryRateLimiter") {}

export class SourceMapObjectError extends Schema.TaggedError<SourceMapObjectError>()(
  "SourceMapObjectError",
  { key: Schema.String, cause: Schema.Defect() },
) {}

/** An object in the source maps bucket, read only once its size is known to fit. */
interface StoredSourceMap {
  readonly size: number;
  readonly text: Effect.Effect<string, SourceMapObjectError>;
}

interface FoundSourceMap {
  readonly key: string;
  readonly map: CompactSourceMap;
}

export class SourceMaps extends Context.Service<
  SourceMaps,
  {
    readonly find: (key: string) => Effect.Effect<FoundSourceMap | SourceMapMiss>;
  }
>()("t3code-relay/mobileTelemetry/MobileTelemetry/SourceMaps") {}

export class SourceMapObjects extends Context.Service<
  SourceMapObjects,
  {
    readonly get: (key: string) => Effect.Effect<StoredSourceMap | undefined, SourceMapObjectError>;
  }
>()("t3code-relay/mobileTelemetry/MobileTelemetry/SourceMapObjects") {}

const makeSourceMaps = Effect.gen(function* () {
  const objects = yield* SourceMapObjects;
  // The cache only joins lookups of one key; a decode holds ~40 MB, so different keys take turns.
  const decoding = yield* Semaphore.make(1);
  const cache = yield* Cache.makeWith(
    (key: string) =>
      Effect.gen(function* () {
        const stored = yield* objects.get(key);
        if (stored === undefined) return "source_map_missing" as const;
        if (stored.size > MAX_SOURCE_MAP_BYTES) {
          yield* Effect.logWarning("Stored mobile source map is too large", {
            key,
            size: stored.size,
          });
          return "source_map_too_large" as const;
        }
        const map = decodeSourceMap(parseJson(yield* stored.text));
        if (typeof map !== "string") return { key, map } satisfies FoundSourceMap;
        yield* Effect.logWarning("Stored mobile source map could not be decoded", { key, map });
        return map === "too_large"
          ? ("source_map_too_large" as const)
          : ("source_map_invalid" as const);
      }).pipe(Semaphore.withPermit(decoding)),
    {
      capacity: SOURCE_MAP_CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isFailure(exit)
          ? FAILED_SOURCE_MAP_TTL
          : typeof exit.value === "string"
            ? MISSING_SOURCE_MAP_TTL
            : Duration.infinity,
    },
  );
  return SourceMaps.of({
    find: Effect.fn("MobileTelemetry.findSourceMap")(function* (key: string) {
      return yield* Cache.get(cache, key).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Mobile source map lookup failed", { key: error.key }).pipe(
            Effect.as("source_map_unavailable" as const),
          ),
        ),
      );
    }),
  });
});

/** Build once per Worker isolate, not per request: decoding a production map costs ~150 ms. */
export const layerSourceMaps = Layer.effect(SourceMaps, makeSourceMaps);

export class MobileTelemetry extends Context.Service<
  MobileTelemetry,
  {
    readonly handle: (
      request: HttpServerRequest.HttpServerRequest,
      params: { readonly projectId: string; readonly signal: RelayMobileTelemetrySignal },
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
  }
>()("t3code-relay/mobileTelemetry/MobileTelemetry") {}

export const layer = Layer.succeed(MobileTelemetry, {
  handle: Effect.fn("relay.mobile_telemetry.ingest")(() =>
    Effect.succeed(HttpServerResponse.empty({ status: 403 })),
  ),
});

// Keep old clients compatible without reading or forwarding telemetry payloads.
export const layerApi = HttpApiBuilder.group(
  RelayApi,
  "mobileTelemetry",
  Effect.fnUntraced(function* (handlers) {
    const telemetry = yield* MobileTelemetry;
    return handlers.handleRaw("ingest", ({ request, params }) => telemetry.handle(request, params));
  }),
);
