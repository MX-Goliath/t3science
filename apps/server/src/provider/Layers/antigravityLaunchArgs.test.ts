import { describe, expect, it } from "@effect/vitest";

import {
  ANTIGRAVITY_PRINT_TIMEOUT,
  ANTIGRAVITY_WINDOWS_PROMPT_LIMIT,
  antigravityPermissionPlan,
  buildAntigravityCommandArgs,
  buildAntigravityTurnArgs,
  isAntigravityPromptTooLongForPlatform,
  resolveAntigravityLaunchArgs,
  T3CODE_ANTIGRAVITY_LAUNCH_ARGS_ENV,
} from "./antigravityLaunchArgs.ts";

describe("antigravityPermissionPlan", () => {
  it("unlocks everything for full access", () => {
    expect(antigravityPermissionPlan({ runtimeMode: "full-access" })).toEqual({
      skipPermissions: true,
    });
  });

  it("auto-approves edits only for auto-accept-edits and auto", () => {
    for (const runtimeMode of ["auto-accept-edits", "auto"] as const) {
      const plan = antigravityPermissionPlan({ runtimeMode });
      expect(plan.skipPermissions).toBe(false);
      expect(plan.mode).toBe("accept-edits");
      expect(plan.degraded).toContain("cannot ask for approval");
    }
  });

  it("explains that supervised cannot prompt", () => {
    const plan = antigravityPermissionPlan({ runtimeMode: "approval-required" });
    expect(plan.skipPermissions).toBe(false);
    expect(plan.mode).toBeUndefined();
    expect(plan.degraded).toContain("Full access");
  });

  it("lets plan mode win over the permission mode", () => {
    expect(
      antigravityPermissionPlan({ runtimeMode: "full-access", interactionMode: "plan" }),
    ).toEqual({ skipPermissions: false, mode: "plan" });
  });
});

describe("buildAntigravityTurnArgs", () => {
  it("opens a new project on the first turn so the CLI adopts the thread cwd", () => {
    const args = buildAntigravityTurnArgs({
      prompt: "hello",
      model: "gemini-3.1-pro-high",
      runtimeMode: "full-access",
    });
    expect(args).toEqual([
      "--output-format",
      "stream-json",
      "--print-timeout",
      ANTIGRAVITY_PRINT_TIMEOUT,
      "--model",
      "gemini-3.1-pro-high",
      "--dangerously-skip-permissions",
      "--new-project",
      "--print",
      "hello",
    ]);
  });

  it("resumes an existing conversation instead of opening a project", () => {
    const args = buildAntigravityTurnArgs({
      prompt: "and now?",
      conversationId: "4c8674a3-41da-4a5f-8c74-c9eea9c4fa13",
      runtimeMode: "auto-accept-edits",
    });
    expect(args).toContain("--conversation");
    expect(args).toContain("4c8674a3-41da-4a5f-8c74-c9eea9c4fa13");
    expect(args).not.toContain("--new-project");
    expect(args.join(" ")).toContain("--mode accept-edits");
  });

  it("keeps the prompt last so a leading dash is never read as a flag", () => {
    const args = buildAntigravityTurnArgs({
      prompt: "--help me",
      runtimeMode: "full-access",
      launchArgs: "--add-dir /srv/shared",
    });
    expect(args.slice(-2)).toEqual(["--print", "--help me"]);
    expect(args.join(" ")).toContain("--add-dir /srv/shared");
  });

  it("appends extra workspace directories", () => {
    const args = buildAntigravityTurnArgs({
      prompt: "hi",
      runtimeMode: "full-access",
      additionalDirectories: ["/a", " ", "/b"],
    });
    expect(args.filter((arg) => arg === "--add-dir")).toHaveLength(2);
    expect(args).toContain("/a");
    expect(args).toContain("/b");
  });

  it("raises the CLI print timeout past its five-minute default", () => {
    const args = buildAntigravityTurnArgs({ prompt: "hi", runtimeMode: "full-access" });
    expect(args[args.indexOf("--print-timeout") + 1]).toBe("24h");
  });
});

describe("resolveAntigravityLaunchArgs", () => {
  it("prefers the environment override over settings", () => {
    expect(
      resolveAntigravityLaunchArgs("--from-settings", {
        [T3CODE_ANTIGRAVITY_LAUNCH_ARGS_ENV]: "--from-env",
      }),
    ).toBe("--from-env");
    expect(resolveAntigravityLaunchArgs("--from-settings", {})).toBe("--from-settings");
    expect(resolveAntigravityLaunchArgs(undefined, {})).toBe("");
  });
});

describe("buildAntigravityCommandArgs", () => {
  it("asks for JSON so the structured command payload survives", () => {
    expect(buildAntigravityCommandArgs("/usage")).toEqual([
      "--output-format",
      "json",
      "--print",
      "/usage",
    ]);
  });
});

describe("isAntigravityPromptTooLongForPlatform", () => {
  it("only guards Windows, where argv is capped", () => {
    const prompt = "x".repeat(ANTIGRAVITY_WINDOWS_PROMPT_LIMIT + 1);
    expect(isAntigravityPromptTooLongForPlatform({ prompt, platform: "win32" })).toBe(true);
    expect(isAntigravityPromptTooLongForPlatform({ prompt, platform: "linux" })).toBe(false);
    expect(isAntigravityPromptTooLongForPlatform({ prompt: "short", platform: "win32" })).toBe(
      false,
    );
  });
});
