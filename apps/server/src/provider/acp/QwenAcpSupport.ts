import { type QwenCodeSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export interface QwenAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly qwenSettings: Pick<QwenCodeSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildQwenAcpSpawnInput(
  qwenSettings: Pick<QwenCodeSettings, "binaryPath"> | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: qwenSettings?.binaryPath || "qwen",
    args: ["--acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export function resolveQwenAcpRequestedModel(model: string | null | undefined): string | undefined {
  const resolved = model?.trim();
  return resolved && resolved !== "current" ? resolved : undefined;
}

export const makeQwenAcpRuntime = (
  input: QwenAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildQwenAcpSpawnInput(input.qwenSettings, input.cwd, input.environment),
        // Qwen Code validates the provider already selected in ~/.qwen. Calling
        // authenticate here would forcibly switch that configuration to OpenAI.
        authMethodId: null,
        clientCapabilities: {
          _meta: { "terminal-auth": false },
        },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function applyQwenAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setModel">;
  readonly model: string | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<void, E> {
  const model = input.model?.trim();
  return model
    ? input.runtime.setModel(model).pipe(Effect.mapError(input.mapError), Effect.asVoid)
    : Effect.void;
}
