import { describe, expect, it } from "vite-plus/test";

import { resolveQwenMode } from "./QwenCodeAdapter.ts";

describe("resolveQwenMode", () => {
  it.each([
    ["approval-required", "default"],
    ["auto-accept-edits", "auto-edit"],
    ["auto", "auto"],
    ["full-access", "yolo"],
  ] as const)("maps %s to Qwen's %s mode", (runtimeMode, expected) => {
    expect(resolveQwenMode(runtimeMode, undefined)).toBe(expected);
  });

  it("lets plan interaction override the runtime permission mode", () => {
    expect(resolveQwenMode("full-access", "plan")).toBe("plan");
  });
});
