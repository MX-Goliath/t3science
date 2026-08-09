import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProjectScript } from "./orchestration.ts";

const decodeProjectScript = Schema.decodeUnknownSync(ProjectScript);

describe("ProjectScript", () => {
  it("keeps decoding legacy terminal actions without a kind", () => {
    expect(
      decodeProjectScript({
        id: "test",
        name: "Test",
        command: "vp test",
        icon: "test",
        runOnWorktreeCreate: false,
      }),
    ).toMatchObject({ command: "vp test" });
  });

  it("decodes prompt actions with model options", () => {
    expect(
      decodeProjectScript({
        id: "review",
        name: "Review",
        kind: "prompt",
        prompt: "Review the current changes.",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5.4",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        icon: "play",
        runOnWorktreeCreate: false,
      }),
    ).toMatchObject({
      kind: "prompt",
      modelSelection: {
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    });
  });

  it("rejects prompt actions without a model", () => {
    expect(() =>
      decodeProjectScript({
        id: "review",
        name: "Review",
        kind: "prompt",
        prompt: "Review the current changes.",
        icon: "play",
        runOnWorktreeCreate: false,
      }),
    ).toThrow();
  });
});
