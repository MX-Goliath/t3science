/**
 * AntigravityTextGeneration — commit messages, PR content, branch names, and
 * thread titles through the Antigravity CLI.
 *
 * Runs `agy --print <prompt> --output-format json --json-schema <file>`: the
 * CLI enforces the schema on the final response, so the answer arrives as a
 * single JSON object on `result.response`. Slash-command expansion is disabled
 * (a diff or commit body can legitimately start with `/`) and the CLI stays in
 * its default permission mode, which soft-denies every tool — text generation
 * must never touch the working tree.
 *
 * @module textGeneration/AntigravityTextGeneration
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  type AntigravitySettings,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  antigravityLaunchArgv,
  resolveAntigravityLaunchArgs,
} from "../provider/Layers/antigravityLaunchArgs.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const ANTIGRAVITY_TIMEOUT_MS = 180_000;
/** Well under the CLI's own budget so the failure is ours, with our message. */
const ANTIGRAVITY_PRINT_TIMEOUT = "3m";

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pull the model's answer out of the print-mode envelope
 * (`{"status":"SUCCESS","response":"…"}`). Returns the CLI's own error text
 * when the run failed so callers can surface something actionable.
 */
export function readAntigravityPrintResponse(
  stdout: string,
): { readonly response: string } | { readonly error: string } {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { error: "Antigravity returned no output." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: "Antigravity returned output that was not JSON." };
  }
  if (!isRecord(parsed)) return { error: "Antigravity returned an unexpected payload." };
  const status = typeof parsed.status === "string" ? parsed.status.toUpperCase() : "";
  const response = typeof parsed.response === "string" ? parsed.response.trim() : "";
  if (status !== "SUCCESS") {
    const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
    return { error: error.length > 0 ? error : "Antigravity reported a failed run." };
  }
  if (response.length === 0) return { error: "Antigravity returned an empty response." };
  return { response };
}

export const makeAntigravityTextGeneration = Effect.fn("makeAntigravityTextGeneration")(function* (
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const launchArgs = resolveAntigravityLaunchArgs(settings.launchArgs, environment);

  const writeSchemaFile = (
    operation: TextGenerationOperation,
    content: string,
  ): Effect.Effect<string, TextGenerationError, Scope.Scope> =>
    fileSystem.makeTempFileScoped({ prefix: `t3code-antigravity-schema-${process.pid}-` }).pipe(
      Effect.tap((filePath) => fileSystem.writeFileString(filePath, content)),
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to write the structured output schema.",
            cause,
          }),
      ),
    );

  const readStreamAsString = <E>(
    operation: TextGenerationOperation,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (accumulator, chunk) => accumulator + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("agy", operation, cause, "Failed to collect process output"),
      ),
    );

  const runAntigravityJson = Effect.fn("runAntigravityJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation: TextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const schemaJson = yield* encodeJsonString(toJsonSchemaObject(outputSchemaJson)).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to encode the structured output schema.",
            cause,
          }),
      ),
    );
    const schemaPath = yield* writeSchemaFile(operation, schemaJson);

    const spawnCommand = yield* resolveSpawnCommand(
      settings.binaryPath || "agy",
      [
        "--output-format",
        "json",
        "--print-timeout",
        ANTIGRAVITY_PRINT_TIMEOUT,
        "--disable-slash-commands",
        "--json-schema",
        schemaPath,
        ...(modelSelection.model ? ["--model", modelSelection.model] : []),
        ...antigravityLaunchArgv(launchArgs),
        "--print",
        prompt,
      ],
      { env: environment },
    ).pipe(
      Effect.mapError((cause) =>
        normalizeCliError("agy", operation, cause, "Failed to resolve the Antigravity CLI"),
      ),
    );

    const child = yield* commandSpawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: environment,
          cwd,
          shell: spawnCommand.shell,
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          normalizeCliError("agy", operation, cause, "Failed to spawn the Antigravity CLI"),
        ),
      );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        readStreamAsString(operation, child.stdout),
        readStreamAsString(operation, child.stderr),
        child.exitCode.pipe(
          Effect.map(Number),
          Effect.mapError((cause) =>
            normalizeCliError("agy", operation, cause, "Failed to await the Antigravity CLI"),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const outcome = readAntigravityPrintResponse(stdout);
    if ("error" in outcome) {
      return yield* new TextGenerationError({
        operation,
        detail:
          exitCode === 0
            ? outcome.error
            : `${outcome.error} (agy exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-1)[0]}` : ""})`,
      });
    }

    const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
    return yield* decodeOutput(extractJsonObject(outcome.response)).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Antigravity returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  const runWithTimeout = <A, E extends TextGenerationError, R>(
    operation: TextGenerationOperation,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, TextGenerationError, R> =>
    effect.pipe(
      Effect.timeoutOption(ANTIGRAVITY_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Antigravity CLI request timed out." }),
            ),
          onSome: (value: A) => Effect.succeed(value),
        }),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("AntigravityTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runWithTimeout(
        "generateCommitMessage",
        runAntigravityJson({
          operation: "generateCommitMessage",
          cwd: input.cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        }),
      );

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("AntigravityTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runWithTimeout(
        "generatePrContent",
        runAntigravityJson({
          operation: "generatePrContent",
          cwd: input.cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        }),
      );

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("AntigravityTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runWithTimeout(
        "generateBranchName",
        runAntigravityJson({
          operation: "generateBranchName",
          cwd: input.cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        }),
      );

      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("AntigravityTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runWithTimeout(
        "generateThreadTitle",
        runAntigravityJson({
          operation: "generateThreadTitle",
          cwd: input.cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        }),
      );

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
