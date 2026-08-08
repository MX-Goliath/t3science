import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { QwenCodeSettings } from "@t3tools/contracts";

import {
  buildInitialQwenCodeProviderSnapshot,
  checkQwenCodeProviderStatus,
} from "./QwenCodeProvider.ts";

const decodeQwenCodeSettings = Schema.decodeSync(QwenCodeSettings);

describe("Qwen Code provider snapshot", () => {
  it.effect("exposes the default Qwen coding model and custom models", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialQwenCodeProviderSnapshot(
        decodeQwenCodeSettings({ customModels: ["qwen3.5-plus"] }),
      );

      expect(snapshot.status).toBe("warning");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["current", "qwen3.5-plus"]);
    }),
  );
});

it.layer(NodeServices.layer)("checkQwenCodeProviderStatus", (it) => {
  it.effect("reports a missing Qwen CLI", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkQwenCodeProviderStatus(
        decodeQwenCodeSettings({ binaryPath: "/definitely/not/installed/qwen" }),
      );

      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("Qwen Code CLI");
    }),
  );
});
