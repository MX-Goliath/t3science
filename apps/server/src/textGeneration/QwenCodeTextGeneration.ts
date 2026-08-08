import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  type ModelSelection,
  type QwenCodeSettings,
  TextGenerationError,
} from "@t3tools/contracts";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";
import {
  applyQwenAcpModelSelection,
  makeQwenAcpRuntime,
  resolveQwenAcpRequestedModel,
} from "../provider/acp/QwenAcpSupport.ts";

const QWEN_CODE_TIMEOUT_MS = 180_000;
const isTextGenerationError = Schema.is(TextGenerationError);

export const makeQwenCodeTextGeneration = Effect.fn("makeQwenCodeTextGeneration")(function* (
  qwenSettings: QwenCodeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const agentName = "Qwen Code";

  const runQwenCodeJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchema,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchema: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const output = yield* Ref.make("");
      const runtime = yield* makeQwenAcpRuntime({
        qwenSettings,
        environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));
      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") return Effect.void;
        const content = update.content;
        if (content.type !== "text") return Effect.void;
        return Ref.update(output, (current) => current + content.text);
      });
      const promptResult = yield* Effect.gen(function* () {
        yield* runtime.start();
        yield* runtime.setMode("plan");
        yield* applyQwenAcpModelSelection({
          runtime,
          model: resolveQwenAcpRequestedModel(modelSelection.model),
          mapError: (cause) =>
            new TextGenerationError({
              operation,
              detail: `Failed to set ${agentName} model.`,
              cause,
            }),
        });
        return yield* runtime.prompt({ prompt: [{ type: "text", text: prompt }] });
      }).pipe(
        Effect.timeoutOption(QWEN_CODE_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: `${agentName} request timed out.` }),
              ),
            onSome: Effect.succeed,
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: `${agentName} ACP request failed.`,
                cause,
              }),
        ),
      );
      const raw = (yield* Ref.get(output)).trim();
      if (!raw) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? `${agentName} ACP request was cancelled.`
              : `${agentName} returned empty output.`,
        });
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchema))(
        extractJsonObject(raw),
      ).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: `${agentName} returned invalid structured output.`,
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: `${agentName} ACP text generation failed.`,
              cause,
            }),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("QwenCodeTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runQwenCodeJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...(typeof generated === "object" &&
        "branch" in generated &&
        typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });
  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("QwenCodeTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runQwenCodeJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });
  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("QwenCodeTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runQwenCodeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });
  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("QwenCodeTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runQwenCodeJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });
  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
