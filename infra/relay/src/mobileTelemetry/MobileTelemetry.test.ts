import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as MobileTelemetry from "./MobileTelemetry.ts";

it.effect("rejects every mobile telemetry signal without forwarding data", () => {
  let requests = 0;
  return Effect.gen(function* () {
    const telemetry = yield* MobileTelemetry.MobileTelemetry;
    for (const signal of ["traces", "logs", "metrics"] as const) {
      const response = yield* telemetry.handle(
        HttpServerRequest.fromWeb(
          new Request("https://relay.example.com/v1/mobile/observe/project/v1/" + signal, {
            method: "POST",
            body: "private crash report",
          }),
        ),
        { projectId: "project", signal },
      );
      expect(response.status).toBe(403);
    }
    expect(requests).toBe(0);
  }).pipe(
    Effect.provide(MobileTelemetry.layer),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => {
        requests += 1;
        return Effect.die("Unexpected telemetry request");
      }),
    ),
  );
});
