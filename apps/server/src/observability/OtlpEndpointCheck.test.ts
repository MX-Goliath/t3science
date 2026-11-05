import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";

import * as OtlpEndpointCheck from "./OtlpEndpointCheck.ts";

it.effect("rejects telemetry endpoint probes without a network request", () => {
  let requests = 0;
  return Effect.gen(function* () {
    const checker = yield* OtlpEndpointCheck.OtlpEndpointCheck;
    for (const signal of ["traces", "metrics", "logs"] as const) {
      assert.deepEqual(yield* checker.check({ signal, url: "https://collector.example.com" }), {
        _tag: "Rejected",
        status: 403,
      });
    }
    assert.equal(requests, 0);
  }).pipe(
    Effect.provide(OtlpEndpointCheck.layer),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => {
        requests += 1;
        return Effect.die("Unexpected telemetry request");
      }),
    ),
  );
});
