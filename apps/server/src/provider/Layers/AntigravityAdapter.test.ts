// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  AntigravitySettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeAntigravityAdapter, parseAntigravityResumeCursor } from "./AntigravityAdapter.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);
const PROVIDER = ProviderDriverKind.make("antigravity");
const INSTANCE_ID = ProviderInstanceId.make("antigravity");

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockCliPath = NodePath.join(__dirname, "../testFixtures/antigravityMockCli.mjs");

interface MockCli {
  readonly binaryPath: string;
  readonly argsFile: string;
  readonly dir: string;
}

/**
 * A shell wrapper is used rather than pointing `binaryPath` at node directly:
 * the adapter spawns one executable with its own argv, exactly as it would
 * spawn the real `agy`.
 */
async function makeMockCli(scenario: string): Promise<MockCli> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-agy-mock-"));
  const binaryPath = NodePath.join(dir, "agy");
  const argsFile = NodePath.join(dir, "args.jsonl");
  const script = `#!/bin/sh
export T3_MOCK_AGY_SCENARIO=${JSON.stringify(scenario)}
export T3_MOCK_AGY_ARGS_FILE=${JSON.stringify(argsFile)}
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockCliPath)} "$@"
`;
  await NodeFSP.writeFile(binaryPath, script, "utf8");
  await NodeFSP.chmod(binaryPath, 0o755);
  return { binaryPath, argsFile, dir };
}

async function readInvocations(
  argsFile: string,
): Promise<ReadonlyArray<{ readonly argv: ReadonlyArray<string>; readonly cwd: string }>> {
  const raw = await NodeFSP.readFile(argsFile, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { argv: string[]; cwd: string });
}

const adapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-antigravity-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (binaryPath: string) =>
  makeAntigravityAdapter(decodeAntigravitySettings({ binaryPath }), {
    instanceId: INSTANCE_ID,
  }).pipe(Effect.orDie);

/** Collect events until the turn settles, then stop collecting. */
const collectUntilTurnCompleted = (adapter: {
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}) =>
  Effect.gen(function* () {
    const events: Array<ProviderRuntimeEvent> = [];
    const turnCompleted = yield* Deferred.make<void>();
    const fiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        events.push(event);
      }).pipe(
        Effect.andThen(
          event.type === "turn.completed"
            ? Deferred.succeed(turnCompleted, undefined)
            : Effect.void,
        ),
      ),
    ).pipe(Effect.forkChild);
    // Let the forked subscriber attach before the caller publishes anything:
    // `PubSub` only replays to subscribers that are already listening.
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    return { events, turnCompleted, fiber } as const;
  });

it("parses only its own resume cursors", () => {
  assert.deepStrictEqual(
    parseAntigravityResumeCursor({ schemaVersion: 1, conversationId: "abc", cwd: "/repo" }),
    { schemaVersion: 1, conversationId: "abc", cwd: "/repo" },
  );
  assert.isUndefined(parseAntigravityResumeCursor(undefined));
  assert.isUndefined(parseAntigravityResumeCursor({ schemaVersion: 2, conversationId: "abc" }));
  assert.isUndefined(parseAntigravityResumeCursor({ schemaVersion: 1, sessionId: "abc" }));
});

it.layer(adapterTestLayer)("AntigravityAdapter", (it) => {
  it.effect("maps a headless turn onto canonical runtime events", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-basic");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const collected = yield* collectUntilTurnCompleted(adapter);

      const session = yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE_ID, model: "gemini-3.1-pro-high" },
      });
      assert.equal(session.provider, PROVIDER);
      assert.equal(session.model, "gemini-3.1-pro-high");
      assert.equal(session.status, "ready");

      const turn = yield* adapter.sendTurn({ threadId, input: "list the files" });
      yield* Deferred.await(collected.turnCompleted);
      yield* Fiber.interrupt(collected.fiber);

      const types = collected.events.map((event) => event.type);
      assert.includeMembers(types, [
        "session.started",
        "session.state.changed",
        "thread.started",
        "session.configured",
        "turn.started",
        "item.started",
        "content.delta",
        "item.completed",
        "thread.token-usage.updated",
        "turn.completed",
      ] as const);

      // Assistant text streams as deltas on a single item.
      const deltas = collected.events.filter((event) => event.type === "content.delta");
      assert.equal(
        deltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")).join(""),
        "Listing files.\n",
      );

      // The command tool becomes a command_execution item carrying its output.
      const toolCompleted = collected.events.find(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "command_execution",
      );
      assert.isDefined(toolCompleted);
      if (toolCompleted?.type === "item.completed") {
        assert.equal(toolCompleted.payload.status, "completed");
        assert.equal(toolCompleted.payload.title, "ls -la");
      }

      // Bookkeeping steps never reach the timeline.
      assert.isUndefined(
        collected.events.find(
          (event) => event.type === "item.started" && event.payload.itemType === "unknown",
        ),
      );

      const completed = collected.events.find((event) => event.type === "turn.completed");
      assert.isDefined(completed);
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "completed");
        assert.equal(completed.turnId, turn.turnId);
      }

      const usage = collected.events.find((event) => event.type === "thread.token-usage.updated");
      if (usage?.type === "thread.token-usage.updated") {
        assert.equal(usage.payload.usage.usedTokens, 120 + 900 + 30);
      }

      // The CLI conversation id is persisted so the thread can be recovered.
      assert.deepStrictEqual(turn.resumeCursor, {
        schemaVersion: 1,
        conversationId: "conv-mock-1",
        cwd: mock.dir,
      });

      const invocations = yield* Effect.promise(() => readInvocations(mock.argsFile));
      assert.equal(invocations.length, 1);
      assert.include(invocations[0]?.argv ?? [], "--new-project");
      assert.include(invocations[0]?.argv ?? [], "--dangerously-skip-permissions");
      assert.equal(invocations[0]?.cwd, yield* Effect.promise(() => NodeFSP.realpath(mock.dir)));

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("resumes the CLI conversation on later turns", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-resume");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "first" });
      yield* adapter.sendTurn({ threadId, input: "second" });

      const invocations = yield* Effect.promise(() => readInvocations(mock.argsFile));
      assert.equal(invocations.length, 2);
      assert.include(invocations[0]?.argv ?? [], "--new-project");
      assert.notInclude(invocations[1]?.argv ?? [], "--new-project");
      const secondArgv = invocations[1]?.argv ?? [];
      assert.equal(secondArgv[secondArgv.indexOf("--conversation") + 1], "conv-mock-1");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("restores the conversation from a persisted resume cursor", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-recover");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      const session = yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
        resumeCursor: { schemaVersion: 1, conversationId: "conv-persisted", cwd: mock.dir },
      });
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        conversationId: "conv-persisted",
        cwd: mock.dir,
      });

      yield* adapter.sendTurn({ threadId, input: "carry on" });
      const invocations = yield* Effect.promise(() => readInvocations(mock.argsFile));
      const argv = invocations[0]?.argv ?? [];
      assert.equal(argv[argv.indexOf("--conversation") + 1], "conv-persisted");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("reports a denied tool as declined and explains the permission mode once", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-denied");
      const mock = yield* Effect.promise(() => makeMockCli("denied"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const collected = yield* collectUntilTurnCompleted(adapter);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({ threadId, input: "write a file" });
      yield* Deferred.await(collected.turnCompleted);
      yield* Fiber.interrupt(collected.fiber);

      const item = collected.events.find(
        (event) => event.type === "item.completed" && event.payload.itemType === "file_change",
      );
      assert.isDefined(item);
      if (item?.type === "item.completed") {
        assert.equal(item.payload.status, "declined");
      }

      const denied = collected.events.filter((event) => event.type === "tool.denied");
      assert.equal(denied.length, 1);
      if (denied[0]?.type === "tool.denied") {
        assert.equal(denied[0].payload.toolName, "write_to_file");
      }

      const warnings = collected.events.filter((event) => event.type === "runtime.warning");
      assert.equal(warnings.length, 1);
      if (warnings[0]?.type === "runtime.warning") {
        assert.include(warnings[0].payload.message, "Full access");
      }

      // A denial is not a failed turn: the agent kept going and answered.
      const completed = collected.events.find((event) => event.type === "turn.completed");
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "completed");
      }

      const argv = (yield* Effect.promise(() => readInvocations(mock.argsFile)))[0]?.argv ?? [];
      assert.notInclude(argv, "--dangerously-skip-permissions");
      assert.notInclude(argv, "--mode");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("fails the turn when the CLI reports an error result", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-error");
      const mock = yield* Effect.promise(() => makeMockCli("provider-error"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const collected = yield* collectUntilTurnCompleted(adapter);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "do something" });
      yield* Deferred.await(collected.turnCompleted);
      yield* Fiber.interrupt(collected.fiber);

      const error = collected.events.find((event) => event.type === "runtime.error");
      assert.isDefined(error);
      if (error?.type === "runtime.error") {
        assert.include(error.payload.message, "terminated due to error");
      }
      const completed = collected.events.find((event) => event.type === "turn.completed");
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "failed");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("surfaces a crashed CLI with its stderr tail", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-crash");
      const mock = yield* Effect.promise(() => makeMockCli("crash"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const collected = yield* collectUntilTurnCompleted(adapter);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "boom" });
      yield* Deferred.await(collected.turnCompleted);
      yield* Fiber.interrupt(collected.fiber);

      const error = collected.events.find((event) => event.type === "runtime.error");
      assert.isDefined(error);
      if (error?.type === "runtime.error") {
        assert.include(error.payload.message, "exited with code 3");
        assert.include(error.payload.message, "something went wrong");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("renders a print-mode command that never opens an assistant step", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-command");
      const mock = yield* Effect.promise(() => makeMockCli("command-only"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const collected = yield* collectUntilTurnCompleted(adapter);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "/usage" });
      yield* Deferred.await(collected.turnCompleted);
      yield* Fiber.interrupt(collected.fiber);

      const delta = collected.events.find((event) => event.type === "content.delta");
      assert.isDefined(delta);
      if (delta?.type === "content.delta") {
        assert.include(delta.payload.delta, "Weekly Limit Remaining");
      }
      const completed = collected.events.find((event) => event.type === "turn.completed");
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "completed");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("interrupts a running turn by terminating the CLI", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-interrupt");
      const mock = yield* Effect.promise(() => makeMockCli("hang"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      const events: Array<ProviderRuntimeEvent> = [];
      const sawDelta = yield* Deferred.make<void>();
      const turnCompleted = yield* Deferred.make<void>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          events.push(event);
        }).pipe(
          Effect.andThen(
            event.type === "content.delta"
              ? Deferred.succeed(sawDelta, undefined)
              : event.type === "turn.completed"
                ? Deferred.succeed(turnCompleted, undefined)
                : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      const turnFiber = yield* adapter
        .sendTurn({ threadId, input: "count forever" })
        .pipe(Effect.forkChild);

      // Wait until the CLI is genuinely mid-turn before interrupting.
      yield* Deferred.await(sawDelta);
      yield* adapter.interruptTurn(threadId);
      yield* Deferred.await(turnCompleted);
      yield* Fiber.join(turnFiber);
      yield* Fiber.interrupt(eventsFiber);

      assert.isDefined(events.find((event) => event.type === "turn.aborted"));
      const completed = events.find((event) => event.type === "turn.completed");
      assert.isDefined(completed);
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "interrupted");
      }
      // An interrupted turn is not an error.
      assert.isUndefined(events.find((event) => event.type === "runtime.error"));

      yield* adapter.stopSession(threadId);
      // Real signals and a real child process: the escalation timer must run
      // on the wall clock, not the test clock.
    }).pipe(TestClock.withLive),
  );

  it.effect("rejects an empty turn and unknown threads", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-validation");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      const missing = yield* adapter.sendTurn({ threadId, input: "hi" }).pipe(Effect.flip);
      assert.equal(missing._tag, "ProviderAdapterSessionNotFoundError");

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      const empty = yield* adapter.sendTurn({ threadId, input: "   " }).pipe(Effect.flip);
      assert.equal(empty._tag, "ProviderAdapterValidationError");

      // Headless `agy` never opens approvals, so answering one is a request error.
      const respond = yield* adapter
        .respondToRequest(threadId, "req-1" as never, "accept")
        .pipe(Effect.flip);
      assert.equal(respond._tag, "ProviderAdapterRequestError");

      const rollback = yield* adapter.rollbackThread(threadId, 1).pipe(Effect.flip);
      assert.equal(rollback._tag, "ProviderAdapterRequestError");

      assert.isTrue(yield* adapter.hasSession(threadId));
      yield* adapter.stopSession(threadId);
      assert.isFalse(yield* adapter.hasSession(threadId));
    }),
  );

  it.effect("runs plan mode when the composer asks for it", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-plan");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "plan it", interactionMode: "plan" });

      const argv = (yield* Effect.promise(() => readInvocations(mock.argsFile)))[0]?.argv ?? [];
      assert.equal(argv[argv.indexOf("--mode") + 1], "plan");
      assert.notInclude(argv, "--dangerously-skip-permissions");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("passes reasoning effort and image attachments to the CLI", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-attachments");
      const mock = yield* Effect.promise(() => makeMockCli("basic"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);
      const serverConfig = yield* ServerConfig;
      const attachmentId = "antigravity-attachments-00000000-0000-4000-8000-000000000001";
      const attachmentPath = NodePath.join(serverConfig.attachmentsDir, `${attachmentId}.png`);
      yield* Effect.promise(() =>
        NodeFSP.mkdir(serverConfig.attachmentsDir, { recursive: true }).then(() =>
          NodeFSP.writeFile(attachmentPath, "image"),
        ),
      );

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "describe this",
        attachments: [
          {
            type: "image",
            id: attachmentId,
            name: "sample.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        modelSelection: {
          instanceId: INSTANCE_ID,
          model: "gemini-3.6-flash-high",
          options: [{ id: "effort", value: "high" }],
        },
      });

      const argv = (yield* Effect.promise(() => readInvocations(mock.argsFile)))[0]?.argv ?? [];
      assert.equal(argv[argv.indexOf("--effort") + 1], "high");
      assert.equal(argv[argv.indexOf("--add-dir") + 1], serverConfig.attachmentsDir);
      assert.equal(argv.at(-1), `describe this\n\n@${attachmentPath}`);

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("closes stdin for a headless turn", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-stdin-eof");
      const mock = yield* Effect.promise(() => makeMockCli("stdin-eof"));
      const adapter = yield* makeTestAdapter(mock.binaryPath);

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: mock.dir,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "finish after stdin closes" });

      const thread = yield* adapter.readThread(threadId);
      assert.equal(thread.turns.length, 1);
      yield* adapter.stopSession(threadId);
    }),
  );
});
