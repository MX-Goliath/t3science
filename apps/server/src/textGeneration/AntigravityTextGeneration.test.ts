// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";

import { AntigravitySettings, ProviderInstanceId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  makeAntigravityTextGeneration,
  readAntigravityPrintResponse,
} from "./AntigravityTextGeneration.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);
const MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("antigravity"),
  "gemini-3.1-pro-high",
  [{ id: "effort", value: "high" }],
);

const testLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-antigravity-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

interface FakeCli {
  readonly binaryPath: string;
  readonly argsFile: string;
}

/** Fake `agy` that echoes a canned print-mode envelope and records its argv. */
function makeFakeAgy(dir: string, envelope: string, exitCode = 0): FakeCli {
  const binaryPath = NodePath.join(dir, "agy");
  const argsFile = NodePath.join(dir, "args.json");
  NodeFS.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      `printf '%s' "$*" > ${JSON.stringify(argsFile)}`,
      // The production spawn must immediately provide EOF to headless `agy`.
      "cat >/dev/null",
      `printf '%s' ${JSON.stringify(envelope)}`,
      `exit ${exitCode}`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(binaryPath, 0o755);
  return { binaryPath, argsFile };
}

function withFakeAgy<A, E, R>(
  envelope: string,
  effectFn: (
    textGeneration: TextGeneration.TextGeneration["Service"],
    cli: FakeCli,
  ) => Effect.Effect<A, E, R>,
  exitCode = 0,
) {
  return Effect.gen(function* () {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-antigravity-text-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }),
    );
    const cli = makeFakeAgy(dir, envelope, exitCode);
    const textGeneration = yield* makeAntigravityTextGeneration(
      decodeAntigravitySettings({ binaryPath: cli.binaryPath }),
    );
    return yield* effectFn(textGeneration, cli);
  }).pipe(Effect.scoped);
}

const successEnvelope = (response: unknown) =>
  JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    response: JSON.stringify(response),
    duration_seconds: 0.4,
    num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });

it("reads the print-mode envelope", () => {
  expect(readAntigravityPrintResponse(successEnvelope({ subject: "x", body: "" }))).toEqual({
    response: JSON.stringify({ subject: "x", body: "" }),
  });
  expect(
    readAntigravityPrintResponse(
      JSON.stringify({ status: "ERROR", response: "", error: "quota exhausted" }),
    ),
  ).toEqual({ error: "quota exhausted" });
  expect(
    readAntigravityPrintResponse(JSON.stringify({ status: "SUCCESS", response: "  " })),
  ).toEqual({ error: "Antigravity returned an empty response." });
  expect(readAntigravityPrintResponse("not json")).toEqual({
    error: "Antigravity returned output that was not JSON.",
  });
  expect(readAntigravityPrintResponse("")).toEqual({ error: "Antigravity returned no output." });
});

it.layer(testLayer)("AntigravityTextGeneration", (it) => {
  it.effect("generates a commit message through print mode", () =>
    withFakeAgy(
      successEnvelope({
        subject: "feat(provider): add antigravity",
        body: "- wire the CLI adapter",
      }),
      (textGeneration, cli) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feat/antigravity-provider",
            stagedSummary: "M apps/server/src/provider/Layers/AntigravityAdapter.ts",
            stagedPatch: "diff --git a/x b/x",
            modelSelection: MODEL_SELECTION,
          });

          expect(generated.subject).toBe("feat(provider): add antigravity");
          expect(generated.body).toBe("- wire the CLI adapter");

          const argv = NodeFS.readFileSync(cli.argsFile, "utf8");
          // Structured output is enforced by the CLI, not by prompt discipline.
          expect(argv).toContain("--json-schema");
          expect(argv).toContain("--output-format json");
          // A diff can start with `/`; slash expansion must stay off.
          expect(argv).toContain("--disable-slash-commands");
          expect(argv).toContain("--model gemini-3.1-pro-high");
          expect(argv).toContain("--effort high");
          // Text generation must never be able to touch the tree.
          expect(argv).not.toContain("--dangerously-skip-permissions");
        }),
    ),
  );

  it.effect("generates a thread title", () =>
    withFakeAgy(successEnvelope({ title: "Add Antigravity provider" }), (textGeneration) =>
      Effect.gen(function* () {
        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "add the antigravity cli as a provider",
          modelSelection: MODEL_SELECTION,
        });
        expect(generated.title).toBe("Add Antigravity provider");
      }),
    ),
  );

  it.effect("surfaces the CLI error text when a run fails", () =>
    withFakeAgy(
      JSON.stringify({ status: "ERROR", response: "", error: "Agent execution terminated." }),
      (textGeneration) =>
        Effect.gen(function* () {
          const failure = yield* textGeneration
            .generateThreadTitle({
              cwd: process.cwd(),
              message: "hello",
              modelSelection: MODEL_SELECTION,
            })
            .pipe(Effect.flip);
          expect(failure._tag).toBe("TextGenerationError");
          expect(failure.detail).toContain("Agent execution terminated.");
        }),
    ),
  );

  it.effect("rejects output that does not match the requested schema", () =>
    withFakeAgy(successEnvelope({ unexpected: true }), (textGeneration) =>
      Effect.gen(function* () {
        const failure = yield* textGeneration
          .generateBranchName({
            cwd: process.cwd(),
            message: "make a branch",
            modelSelection: MODEL_SELECTION,
          })
          .pipe(Effect.flip);
        expect(failure.detail).toContain("invalid structured output");
      }),
    ),
  );
});
