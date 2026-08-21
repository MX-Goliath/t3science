// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach, vi } from "vite-plus/test";

import { OpenCodeSettings } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import { checkOpenCodeProviderStatus } from "./OpenCodeProvider.ts";
import {
  normalizeOpenCodeGoUsage,
  parseOpenCodeGoApiKey,
  resolveOpenCodeGoAuthFile,
} from "./OpenCodeGoUsage.ts";
import type { OpenCodeInventory } from "../opencodeRuntime.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DEFAULT_VERSION_STDOUT = "opencode 1.14.19\n";

/**
 * The legacy `OpenCodeProviderLive` Layer + `OpenCodeProvider` service tag
 * are deleted. The snapshot-producing logic they wrapped now lives in the
 * standalone `checkOpenCodeProviderStatus(settings, cwd)` Effect, which
 * drivers call directly when building their per-instance snapshot
 * `ServerProviderShape`. Tests mirror that shape: build a settings payload,
 * invoke the check, assert on the returned snapshot.
 */

const runtimeMock = {
  state: {
    runVersionError: null as Error | null,
    versionStdout: DEFAULT_VERSION_STDOUT,
    inventoryError: null as Error | null,
    inventoryCwd: null as string | null,
    closeCalls: 0,
    inventory: {
      providerList: { connected: [] as string[], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    } as unknown,
  },
  reset() {
    this.state.runVersionError = null;
    this.state.versionStdout = DEFAULT_VERSION_STDOUT;
    this.state.inventoryError = null;
    this.state.inventoryCwd = null;
    this.state.closeCalls = 0;
    this.state.inventory = {
      providerList: { connected: [], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    };
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: () =>
    Effect.succeed({
      url: "http://127.0.0.1:4301",
      exitCode: Effect.never,
    }),
  connectToOpenCodeServer: ({ serverUrl }) =>
    Effect.gen(function* () {
      if (!serverUrl) {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            runtimeMock.state.closeCalls += 1;
          }),
        );
      }
      return {
        url: serverUrl ?? "http://127.0.0.1:4301",
        exitCode: null,
        external: Boolean(serverUrl),
      };
    }),
  runOpenCodeCommand: () =>
    runtimeMock.state.runVersionError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "runOpenCodeCommand",
            detail: runtimeMock.state.runVersionError.message,
            cause: runtimeMock.state.runVersionError,
          }),
        )
      : Effect.succeed({ stdout: runtimeMock.state.versionStdout, stderr: "", code: 0 }),
  createOpenCodeSdkClient: () =>
    ({}) as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>,
  loadOpenCodeInventory: () =>
    runtimeMock.state.inventoryError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "loadOpenCodeInventory",
            detail: runtimeMock.state.inventoryError.message,
            cause: runtimeMock.state.inventoryError,
          }),
        )
      : Effect.succeed(runtimeMock.state.inventory as OpenCodeInventory),
  loadInventoryFromCli: ({ cwd }) => {
    runtimeMock.state.inventoryCwd = cwd;
    return runtimeMock.state.inventoryError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "loadInventoryFromCli",
            detail: runtimeMock.state.inventoryError.message,
            cause: runtimeMock.state.inventoryError,
          }),
        )
      : Effect.succeed(runtimeMock.state.inventory as OpenCodeInventory);
  },
};

const goUsageMock = {
  state: {
    requests: [] as Array<{ url: string; authorization: string | undefined }>,
    payload: {
      usage: {
        rolling: { status: "ok", percent: 13, resetsAt: "2026-08-17T12:00:00.000Z" },
        weekly: { status: "ok", percent: 42, resetsAt: "2026-08-22T12:00:00.000Z" },
        monthly: { status: "ok", percent: 61, resetsAt: "2026-09-16T12:00:00.000Z" },
      },
    },
    status: 200,
    fail: false,
  },
  reset() {
    this.state.requests = [];
    this.state.status = 200;
    this.state.fail = false;
  },
};

beforeEach(() => {
  runtimeMock.reset();
  goUsageMock.reset();
  vi.stubGlobal("fetch", ((url: unknown, init?: RequestInit) => {
    const headers = new Headers(
      (init?.headers ?? undefined) as Record<string, string> | Headers | undefined,
    );
    goUsageMock.state.requests.push({
      url: String(url),
      authorization: headers.get("authorization") ?? undefined,
    });
    if (goUsageMock.state.fail) {
      return Promise.reject(new Error("network down"));
    }
    return Promise.resolve(
      new Response(JSON.stringify(goUsageMock.state.payload), {
        status: goUsageMock.state.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch);
});

const testLayer = Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(NodeServices.layer),
);

const makeOpenCodeSettings = (overrides?: Partial<OpenCodeSettings>): OpenCodeSettings =>
  decodeOpenCodeSettings({
    enabled: true,
    binaryPath: "opencode",
    serverUrl: "",
    serverPassword: "",
    customModels: [],
    ...overrides,
  });

it.layer(testLayer)("checkOpenCodeProviderStatus", (it) => {
  it.effect("shows a codex-style missing binary message", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("spawn opencode ENOENT");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, false);
      NodeAssert.equal(
        snapshot.message,
        "OpenCode CLI (`opencode`) is not installed or not on PATH.",
      );
    }),
  );

  it.effect("hides generic Effect.tryPromise text for local CLI probe failures", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("An error occurred in Effect.tryPromise");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.message, "Failed to execute OpenCode CLI health check.");
    }),
  );

  it.effect("emits OpenCode variant defaults so trait picker can resolve a visible selection", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventory = {
        providerList: {
          connected: ["openai"],
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  variants: {
                    none: {},
                    low: {},
                    medium: {},
                    high: {},
                    xhigh: {},
                  },
                },
              },
            },
          ],
          default: {},
        },
        agents: [
          { name: "build", hidden: false, mode: "primary" },
          { name: "plan", hidden: false, mode: "primary" },
        ],
      };

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());
      const model = snapshot.models.find((entry) => entry.slug === "openai/gpt-5.4");

      NodeAssert.ok(model);
      const variantDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "variant" && descriptor.type === "select",
      );
      NodeAssert.ok(variantDescriptor && variantDescriptor.type === "select");
      NodeAssert.equal(variantDescriptor.label, "Reasoning effort");
      NodeAssert.equal(
        variantDescriptor.options.find((option) => option.isDefault === true)?.id,
        "medium",
      );
      const agentDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "agent" && descriptor.type === "select",
      );
      NodeAssert.ok(agentDescriptor && agentDescriptor.type === "select");
      NodeAssert.equal(
        agentDescriptor.options.find((option) => option.isDefault === true)?.id,
        "build",
      );
    }),
  );

  it.effect("defaults llama.cpp reasoning variants to xhigh", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventory = {
        providerList: {
          connected: ["Llama.cpp"],
          all: [
            {
              id: "Llama.cpp",
              name: "llama.cpp",
              models: {
                "local-reasoner": {
                  id: "local-reasoner",
                  name: "Local Reasoner",
                  variants: {
                    low: {},
                    medium: {},
                    high: {},
                    xhigh: {},
                  },
                },
              },
            },
          ],
          default: {},
        },
        agents: [],
      };

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());
      const model = snapshot.models.find((entry) => entry.slug === "Llama.cpp/local-reasoner");

      NodeAssert.ok(model);
      const variantDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "variant" && descriptor.type === "select",
      );
      NodeAssert.ok(variantDescriptor && variantDescriptor.type === "select");
      NodeAssert.equal(
        variantDescriptor.options.find((option) => option.isDefault === true)?.id,
        "xhigh",
      );
      NodeAssert.equal(variantDescriptor.currentValue, "xhigh");
    }),
  );

  it.effect("includes OpenCode skills in the provider snapshot", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventory = {
        providerList: {
          connected: ["openai"],
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  variants: {},
                },
              },
            },
          ],
          default: {},
        },
        agents: [],
        skills: [
          {
            name: "openclaw-review",
            description: "Review OpenClaw workflow changes.",
            location: "/Users/test/.agents/skills/openclaw-review/SKILL.md",
            content: "---\nname: openclaw-review\n---\n",
          },
          {
            name: "openclaw-triage",
            description: "Triage OpenClaw routing issues.",
            location: "/Users/test/.agents/skills/openclaw-triage/SKILL.md",
            content: "---\nname: openclaw-triage\n---\n",
          },
          {
            name: "missing-location",
            description: "This incomplete SDK row should be skipped.",
            location: "",
            content: "---\nname: missing-location\n---\n",
          },
        ],
      };

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.deepEqual(
        snapshot.skills.map((skill) => ({
          name: skill.name,
          path: skill.path,
          enabled: skill.enabled,
          shortDescription: skill.shortDescription,
        })),
        [
          {
            name: "openclaw-review",
            path: "/Users/test/.agents/skills/openclaw-review/SKILL.md",
            enabled: true,
            shortDescription: "Review OpenClaw workflow changes.",
          },
          {
            name: "openclaw-triage",
            path: "/Users/test/.agents/skills/openclaw-triage/SKILL.md",
            enabled: true,
            shortDescription: "Triage OpenClaw routing issues.",
          },
        ],
      );
    }),
  );

  it.effect("does not spawn a local server for health check (uses CLI instead)", () =>
    Effect.gen(function* () {
      yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(runtimeMock.state.closeCalls, 0);
      NodeAssert.equal(runtimeMock.state.inventoryCwd, process.cwd());
    }),
  );

  it.effect("reports local model inventory failures without treating them as empty", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("opencode models failed");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.models.length, 0);
      NodeAssert.equal(
        snapshot.message,
        "Failed to execute OpenCode CLI health check: opencode models failed",
      );
    }),
  );
});

it.layer(testLayer)("checkOpenCodeProviderStatus with configured server URL", (it) => {
  it.effect("surfaces a friendly auth error for configured servers", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("401 Unauthorized");
      const snapshot = yield* checkOpenCodeProviderStatus(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
        process.cwd(),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(
        snapshot.message,
        "OpenCode server rejected authentication. Check the server URL and password.",
      );
    }),
  );

  it.effect("surfaces a friendly connection error for configured servers", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error(
        "fetch failed: connect ECONNREFUSED 127.0.0.1:9999",
      );
      const snapshot = yield* checkOpenCodeProviderStatus(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
        process.cwd(),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(
        snapshot.message,
        "Couldn't reach the configured OpenCode server at http://127.0.0.1:9999. Check that the server is running and the URL is correct.",
      );
    }),
  );
});

it.layer(testLayer)("openCodeGoUsage pure helpers", (it) => {
  it.effect("normalizes go usage windows into remaining percent", () =>
    Effect.sync(() => {
      const rateLimits = normalizeOpenCodeGoUsage(goUsageMock.state.payload);
      NodeAssert.ok(rateLimits);
      NodeAssert.equal(rateLimits.fiveHour?.remainingPercent, 87);
      NodeAssert.equal(rateLimits.fiveHour?.windowDurationMinutes, 5 * 60);
      NodeAssert.equal(
        rateLimits.fiveHour?.resetsAt,
        Math.floor(Date.parse("2026-08-17T12:00:00.000Z") / 1000),
      );
      NodeAssert.equal(rateLimits.weekly?.remainingPercent, 58);
      NodeAssert.equal(rateLimits.weekly?.windowDurationMinutes, 7 * 24 * 60);
      NodeAssert.equal(rateLimits.monthly?.remainingPercent, 39);
      NodeAssert.equal(rateLimits.monthly?.windowDurationMinutes, 30 * 24 * 60);

      NodeAssert.equal(
        normalizeOpenCodeGoUsage({ usage: { weekly: { percent: -5 } } })?.weekly?.remainingPercent,
        100,
      );
      NodeAssert.equal(
        normalizeOpenCodeGoUsage({ usage: { weekly: { percent: 140 } } })?.weekly?.remainingPercent,
        0,
      );
      NodeAssert.equal(
        normalizeOpenCodeGoUsage({ usage: { weekly: { resetsAt: "x" } } }),
        undefined,
      );
      NodeAssert.equal(normalizeOpenCodeGoUsage({ usage: {} }), undefined);
      NodeAssert.equal(normalizeOpenCodeGoUsage(null), undefined);
      NodeAssert.equal(normalizeOpenCodeGoUsage("nope"), undefined);
    }),
  );

  it.effect("parses the opencode auth file key", () =>
    Effect.sync(() => {
      NodeAssert.equal(
        parseOpenCodeGoApiKey(JSON.stringify({ "opencode-go": { type: "api", key: " key " } })),
        "key",
      );
      NodeAssert.equal(
        parseOpenCodeGoApiKey(JSON.stringify({ "opencode-go": { key: "" } })),
        undefined,
      );
      NodeAssert.equal(parseOpenCodeGoApiKey(JSON.stringify({ openai: { key: "x" } })), undefined);
      NodeAssert.equal(parseOpenCodeGoApiKey("{"), undefined);
    }),
  );

  it.effect("resolves the auth file path per platform", () =>
    Effect.sync(() => {
      NodeAssert.equal(
        resolveOpenCodeGoAuthFile({ environment: {}, platform: "darwin", homeDir: "/Users/x" }),
        "/Users/x/Library/Application Support/opencode/auth.json",
      );
      NodeAssert.equal(
        resolveOpenCodeGoAuthFile({
          environment: { XDG_DATA_HOME: "/data" },
          platform: "linux",
          homeDir: "/Users/x",
        }),
        "/data/opencode/auth.json",
      );
      NodeAssert.equal(
        resolveOpenCodeGoAuthFile({ environment: {}, platform: "linux", homeDir: "/home/x" }),
        "/home/x/.local/share/opencode/auth.json",
      );
    }),
  );
});

it.layer(testLayer)("checkOpenCodeProviderStatus with opencode-go usage", (it) => {
  // Redirects $HOME (and clears Go key variables) so the auth-file probe
  // cannot reach the real opencode installation on the dev machine.
  const setupIsolatedHome = () => {
    const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-opencode-go-"));
    const previousHome = process.env.HOME;
    const previousKey = process.env.OPENCODE_API_KEY;
    const previousXdg = process.env.XDG_DATA_HOME;
    process.env.HOME = homeDir;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.XDG_DATA_HOME;
    return {
      homeDir,
      cleanup: () => {
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
        if (previousKey === undefined) delete process.env.OPENCODE_API_KEY;
        else process.env.OPENCODE_API_KEY = previousKey;
        if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = previousXdg;
        NodeFS.rmSync(homeDir, { recursive: true, force: true });
      },
    };
  };

  it.effect("attaches go rate limits when opencode-go is connected", () =>
    Effect.gen(function* () {
      const { cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["opencode-go"], all: [], default: {} },
          agents: [],
        };
        process.env.OPENCODE_API_KEY = "sk-test-go";

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.deepEqual(goUsageMock.state.requests, [
          {
            url: "https://opencode.ai/zen/go/v1/usage",
            authorization: "Bearer sk-test-go",
          },
        ]);
        NodeAssert.equal(snapshot.rateLimits?.fiveHour?.remainingPercent, 87);
        NodeAssert.equal(
          snapshot.rateLimits?.fiveHour?.resetsAt,
          Math.floor(Date.parse("2026-08-17T12:00:00.000Z") / 1000),
        );
        NodeAssert.equal(snapshot.rateLimits?.weekly?.remainingPercent, 58);
        NodeAssert.equal(snapshot.rateLimits?.weekly?.windowDurationMinutes, 7 * 24 * 60);
        NodeAssert.equal(snapshot.rateLimits?.monthly?.remainingPercent, 39);
        NodeAssert.equal(snapshot.rateLimits?.monthly?.windowDurationMinutes, 30 * 24 * 60);
      } finally {
        cleanup();
      }
    }),
  );

  it.effect("uses the OpenCode instance environment for the go key", () =>
    Effect.gen(function* () {
      const { homeDir, cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["opencode-go"], all: [], default: {} },
          agents: [],
        };

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd(), {
          HOME: homeDir,
          OPENCODE_API_KEY: "sk-instance-go",
        });

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.deepEqual(goUsageMock.state.requests, [
          {
            url: "https://opencode.ai/zen/go/v1/usage",
            authorization: "Bearer sk-instance-go",
          },
        ]);
        NodeAssert.equal(snapshot.rateLimits?.monthly?.remainingPercent, 39);
      } finally {
        cleanup();
      }
    }),
  );

  it.effect("reads the go key from the opencode auth file", () =>
    Effect.gen(function* () {
      const { homeDir, cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["opencode-go"], all: [], default: {} },
          agents: [],
        };
        const authDir = NodePath.join(homeDir, ".local", "share", "opencode");
        NodeFS.mkdirSync(authDir, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(authDir, "auth.json"),
          JSON.stringify({ "opencode-go": { type: "api", key: "sk-file-go" } }),
        );

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.deepEqual(goUsageMock.state.requests, [
          {
            url: "https://opencode.ai/zen/go/v1/usage",
            authorization: "Bearer sk-file-go",
          },
        ]);
        NodeAssert.equal(snapshot.rateLimits?.monthly?.remainingPercent, 39);
      } finally {
        cleanup();
      }
    }),
  );

  it.effect("skips the usage probe when opencode-go is not connected", () =>
    Effect.gen(function* () {
      const { cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["openai"], all: [], default: {} },
          agents: [],
        };
        process.env.OPENCODE_API_KEY = "sk-test-go";

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 0);
        NodeAssert.equal(snapshot.rateLimits, undefined);
      } finally {
        cleanup();
      }
    }),
  );

  it.effect("omits rate limits when no go key is available", () =>
    Effect.gen(function* () {
      const { cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["opencode-go"], all: [], default: {} },
          agents: [],
        };

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 0);
        NodeAssert.equal(snapshot.rateLimits, undefined);
      } finally {
        cleanup();
      }
    }),
  );

  it.effect("keeps the provider healthy when the usage probe fails", () =>
    Effect.gen(function* () {
      const { cleanup } = setupIsolatedHome();
      try {
        runtimeMock.state.inventory = {
          providerList: { connected: ["opencode-go"], all: [], default: {} },
          agents: [],
        };
        process.env.OPENCODE_API_KEY = "sk-test-go";
        goUsageMock.state.fail = true;

        const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 1);
        NodeAssert.equal(snapshot.rateLimits, undefined);
      } finally {
        cleanup();
      }
    }),
  );
});
