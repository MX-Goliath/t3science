#!/usr/bin/env node
/**
 * Temporary manual probe: drives the Antigravity adapter against the real
 * `agy` binary and prints the runtime events it produces.
 *
 * Usage: node apps/server/scripts/antigravity-live-probe.ts <cwd> <model> <prompt>
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { AntigravitySettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import * as ServerConfig from "../src/config.ts";
import { makeAntigravityAdapter } from "../src/provider/Layers/AntigravityAdapter.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const [cwd = process.cwd(), model = "claude-sonnet-4-6", ...promptParts] = process.argv.slice(2);
const prompt = promptParts.join(" ") || "Say exactly: PROBE_OK";

const program = Effect.gen(function* () {
  const adapter = yield* makeAntigravityAdapter(decodeAntigravitySettings({}), {
    instanceId: ProviderInstanceId.make("antigravity"),
  });
  const threadId = ThreadId.make("antigravity-live-probe");
  const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
    Console.log(
      JSON.stringify({
        type: event.type,
        itemId: event.itemId,
        payload: event.payload,
      }).slice(0, 400),
    ),
  ).pipe(Effect.forkChild);

  yield* Effect.yieldNow;
  const session = yield* adapter.startSession({
    threadId,
    cwd,
    runtimeMode: "full-access",
    modelSelection: { instanceId: ProviderInstanceId.make("antigravity"), model },
  });
  yield* Console.log(`session: ${JSON.stringify(session)}`);

  const first = yield* adapter.sendTurn({ threadId, input: prompt });
  yield* Console.log(`turn 1: ${JSON.stringify(first)}`);

  const second = yield* adapter.sendTurn({
    threadId,
    input: "In one short sentence, what did I ask you first?",
  });
  yield* Console.log(`turn 2: ${JSON.stringify(second)}`);

  yield* adapter.stopSession(threadId);
  yield* Fiber.interrupt(eventsFiber);
}).pipe(Effect.scoped);

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(
      ServerConfig.ServerConfig.layerTest(cwd, { prefix: "t3code-antigravity-probe-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
