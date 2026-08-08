import { describe, expect, it } from "vite-plus/test";

import { buildQwenAcpSpawnInput, resolveQwenAcpRequestedModel } from "./QwenAcpSupport.ts";

describe("buildQwenAcpSpawnInput", () => {
  it("starts Qwen Code in its native ACP mode", () => {
    expect(buildQwenAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "qwen",
      args: ["--acp"],
      cwd: "/tmp/project",
    });
  });

  it("passes a configured binary and provider environment through", () => {
    expect(
      buildQwenAcpSpawnInput({ binaryPath: "/opt/qwen/bin/qwen" }, "/tmp/project", {
        OPENAI_API_KEY: "test-key",
      }),
    ).toEqual({
      command: "/opt/qwen/bin/qwen",
      args: ["--acp"],
      cwd: "/tmp/project",
      env: { OPENAI_API_KEY: "test-key" },
    });
  });
});

describe("resolveQwenAcpRequestedModel", () => {
  it("keeps Qwen's configured model for the built-in current selection", () => {
    expect(resolveQwenAcpRequestedModel("current")).toBeUndefined();
  });

  it("passes an exact ACP model route through", () => {
    expect(resolveQwenAcpRequestedModel(" qwen3-coder-plus(openai) ")).toBe(
      "qwen3-coder-plus(openai)",
    );
  });
});
