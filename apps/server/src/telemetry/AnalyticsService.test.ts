import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";

import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("never sends analytics even when legacy configuration enables it", () => {
  let requests = 0;
  const client = HttpClient.make(() => {
    requests += 1;
    return Effect.die("Unexpected telemetry request");
  });
  return Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    yield* analytics.record("server.boot.heartbeat", { platform: "linux" });
    yield* analytics.recordOwners([{ source: "device", ownerId: "device-id" }], "client");
    yield* analytics.flush;
    assert.equal(requests, 0);
  }).pipe(
    Effect.provide(AnalyticsService.layer),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        T3CODE_TELEMETRY_ENABLED: true,
        T3CODE_POSTHOG_HOST: "https://ingest.example.com",
      }),
    ),
  );
});
