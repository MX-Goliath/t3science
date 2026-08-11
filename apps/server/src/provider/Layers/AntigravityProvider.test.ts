import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { AntigravitySettings } from "@t3tools/contracts";

import {
  buildInitialAntigravityProviderSnapshot,
  checkAntigravityProviderStatus,
  isAntigravitySignedOutOutput,
  normalizeAntigravityRateLimits,
  parseAntigravityCommandData,
  parseAntigravityModelList,
  parseAntigravitySkills,
  subProviderForAntigravityModel,
} from "./AntigravityProvider.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

// Verbatim `agy models` stdout (CLI 1.1.11).
const MODELS_STDOUT = [
  "gemini-3.6-flash-high\tGemini 3.6 Flash (High)",
  "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
  "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  "",
].join("\n");

const USAGE_DATA = {
  groups: [
    {
      name: "Gemini Models",
      buckets: [
        {
          id: "gemini-weekly",
          window: "weekly",
          remaining_fraction: 0.9885802865028381,
          reset_time: "2026-08-15T06:21:18Z",
        },
        {
          id: "gemini-5h",
          window: "5h",
          remaining_fraction: 0.5,
          reset_time: "2026-08-10T21:45:18Z",
        },
      ],
    },
    {
      name: "Claude and GPT models",
      buckets: [
        {
          id: "3p-weekly",
          window: "weekly",
          remaining_fraction: 0.2,
          reset_time: "2026-08-15T14:01:59Z",
        },
        { id: "3p-5h", window: "5h", remaining_fraction: 0.1 },
      ],
    },
  ],
};

describe("parseAntigravityModelList", () => {
  it("parses the tab-separated catalog", () => {
    const models = parseAntigravityModelList(MODELS_STDOUT);
    expect(models.map((model) => model.slug)).toEqual([
      "gemini-3.6-flash-high",
      "gemini-3.1-pro-high",
      "claude-sonnet-4-6",
      "gpt-oss-120b-medium",
    ]);
    expect(models[0]?.name).toBe("Gemini 3.6 Flash (High)");
    expect(models[0]?.subProvider).toBe("Google");
    expect(models[2]?.subProvider).toBe("Anthropic");
    expect(models[3]?.subProvider).toBe("OpenAI");
  });

  it("ignores help text and blank output", () => {
    expect(parseAntigravityModelList("Usage: agy models [flags]\n\n")).toEqual([]);
    expect(parseAntigravityModelList("")).toEqual([]);
  });

  it("labels unknown families without a sub-provider", () => {
    expect(subProviderForAntigravityModel("llama-4")).toBeUndefined();
  });
});

describe("normalizeAntigravityRateLimits", () => {
  it("picks the bucket group matching the model family", () => {
    const gemini = normalizeAntigravityRateLimits(USAGE_DATA, { model: "gemini-3.1-pro-high" });
    expect(gemini?.weekly?.remainingPercent).toBe(99);
    expect(gemini?.fiveHour?.remainingPercent).toBe(50);
    expect(gemini?.fiveHour?.windowDurationMinutes).toBe(300);
    expect(gemini?.weekly?.resetsAt).toBe(Math.floor(Date.parse("2026-08-15T06:21:18Z") / 1000));

    const claude = normalizeAntigravityRateLimits(USAGE_DATA, { model: "claude-sonnet-4-6" });
    expect(claude?.weekly?.remainingPercent).toBe(20);
    expect(claude?.fiveHour?.remainingPercent).toBe(10);
    // No reset_time on that bucket — the window still renders.
    expect(claude?.fiveHour?.resetsAt).toBeUndefined();
  });

  it("falls back to the tightest pool when no model is known", () => {
    expect(normalizeAntigravityRateLimits(USAGE_DATA)?.weekly?.remainingPercent).toBe(20);
  });

  it("returns nothing for payloads without usable buckets", () => {
    expect(normalizeAntigravityRateLimits(undefined)).toBeUndefined();
    expect(normalizeAntigravityRateLimits({ groups: [] })).toBeUndefined();
    expect(
      normalizeAntigravityRateLimits({ groups: [{ name: "x", buckets: [] }] }),
    ).toBeUndefined();
  });
});

describe("parseAntigravitySkills", () => {
  it("maps the CLI skill list onto the snapshot shape", () => {
    const skills = parseAntigravitySkills({
      skills: [
        {
          name: "antigravity-guide",
          description: "Guide",
          path: "/home/u/.gemini/antigravity-cli/builtin/skills/antigravity_guide/SKILL.md",
          builtin: true,
        },
        { name: "", path: "/nope" },
        { name: "no-path" },
      ],
    });
    expect(skills).toEqual([
      {
        name: "antigravity-guide",
        path: "/home/u/.gemini/antigravity-cli/builtin/skills/antigravity_guide/SKILL.md",
        enabled: true,
        description: "Guide",
        scope: "builtin",
      },
    ]);
  });
});

describe("parseAntigravityCommandData", () => {
  it("extracts the structured payload of a print-mode command", () => {
    const stdout = JSON.stringify({
      status: "SUCCESS",
      response: "…",
      command: { name: "usage", data: USAGE_DATA },
    });
    expect(parseAntigravityCommandData(stdout)).toEqual(USAGE_DATA);
  });

  it("tolerates non-JSON and command-less output", () => {
    expect(parseAntigravityCommandData("boom")).toBeUndefined();
    expect(parseAntigravityCommandData('{"status":"SUCCESS"}')).toBeUndefined();
  });
});

describe("isAntigravitySignedOutOutput", () => {
  it("recognizes the CLI's sign-in prompts", () => {
    expect(
      isAntigravitySignedOutOutput(
        "Please sign in to view available models. Launch the CLI without arguments to sign in.",
      ),
    ).toBe(true);
    expect(isAntigravitySignedOutOutput("No authentication methods available.")).toBe(true);
    expect(isAntigravitySignedOutOutput("gemini-3.1-pro-high\tGemini")).toBe(false);
  });
});

describe("buildInitialAntigravityProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when the provider is off", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({}),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.showInteractionModeToggle).toBe(true);
      expect(snapshot.models.map((model) => model.slug)).toContain("gemini-3.1-pro-high");
    }),
  );
});

/**
 * Stand-in for the real CLI. `$1` is either `--version`, `models`, or
 * `--output-format` (print mode), which is enough to drive every probe branch.
 */
const makeFakeAgy = (body: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-antigravity-probe-" });
    const binaryPath = path.join(dir, "agy");
    yield* fs.writeFileString(binaryPath, `#!/bin/sh\n${body}\n`);
    yield* fs.chmod(binaryPath, 0o755);
    return binaryPath;
  });

it.layer(NodeServices.layer)("checkAntigravityProviderStatus", (it) => {
  it.effect("reports a missing binary", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ binaryPath: "/definitely/not/installed/agy" }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );

  it.effect("hides CLI stderr when the version probe fails", () =>
    Effect.gen(function* () {
      const secret = "broken install: secret-token-value";
      const binaryPath = yield* makeFakeAgy(`printf "%s\\n" "${secret}" >&2\nexit 2`);
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ binaryPath }),
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Antigravity CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secret);
    }).pipe(Effect.scoped),
  );

  it.effect("marks the provider unauthenticated when the CLI asks for sign-in", () =>
    Effect.gen(function* () {
      const binaryPath = yield* makeFakeAgy(
        [
          'if [ "$1" = "--version" ]; then printf "1.1.11\\n"; exit 0; fi',
          'if [ "$1" = "models" ]; then printf "Please sign in to view available models.\\n"; exit 0; fi',
          "exit 0",
        ].join("\n"),
      );
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ binaryPath }),
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("1.1.11");
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("Sign in");
    }).pipe(Effect.scoped),
  );

  it.effect("builds a ready snapshot with models, skills, and plan limits", () =>
    Effect.gen(function* () {
      const skillsPayload = JSON.stringify({
        status: "SUCCESS",
        response: "",
        command: {
          name: "skills",
          data: { skills: [{ name: "guide", description: "d", path: "/tmp/SKILL.md" }] },
        },
      });
      const usagePayload = JSON.stringify({
        status: "SUCCESS",
        response: "",
        command: { name: "usage", data: USAGE_DATA },
      });
      const binaryPath = yield* makeFakeAgy(
        [
          'if [ "$1" = "--version" ]; then printf "1.1.11\\n"; exit 0; fi',
          `if [ "$1" = "models" ]; then printf '${MODELS_STDOUT.trimEnd().replaceAll("\t", "\\t").replaceAll("\n", "\\n")}\\n'; exit 0; fi`,
          `case "$*" in`,
          `  *"/skills"*) printf '%s' '${skillsPayload}'; exit 0;;`,
          `  *"/usage"*) printf '%s' '${usagePayload}'; exit 0;;`,
          `esac`,
          "exit 0",
        ].join("\n"),
      );

      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ binaryPath }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.1.11");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "gemini-3.6-flash-high",
        "gemini-3.1-pro-high",
        "claude-sonnet-4-6",
        "gpt-oss-120b-medium",
      ]);
      // The CLI's preferred model becomes the picker default.
      expect(snapshot.models.find((model) => model.isDefault)?.slug).toBe("gemini-3.1-pro-high");
      expect(snapshot.skills.map((skill) => skill.name)).toEqual(["guide"]);
      expect(snapshot.slashCommands.map((command) => command.name)).toContain("usage");
      expect(snapshot.rateLimits?.weekly?.remainingPercent).toBe(20);
    }).pipe(Effect.scoped),
  );

  it.effect("omits plan limits when the user turned the meter off", () =>
    Effect.gen(function* () {
      const binaryPath = yield* makeFakeAgy(
        [
          'if [ "$1" = "--version" ]; then printf "1.1.11\\n"; exit 0; fi',
          'if [ "$1" = "models" ]; then printf "gemini-3.1-pro-high\\tGemini 3.1 Pro (High)\\n"; exit 0; fi',
          'printf "%s" "{}"',
        ].join("\n"),
      );
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ binaryPath, showRateLimits: false }),
      );
      expect(snapshot.status).toBe("ready");
      expect(snapshot.rateLimits).toBeUndefined();
    }).pipe(Effect.scoped),
  );
});
