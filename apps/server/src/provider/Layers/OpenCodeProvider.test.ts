// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach, vi } from "vite-plus/test";

import { OpenCodeSettings } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  resolveOpenCodeServerPassword,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
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
    runVersionPending: false,
    versionStdout: DEFAULT_VERSION_STDOUT,
    inventoryError: null as Error | null,
    connectionError: null as Error | null,
    inventoryCwd: null as string | null,
    closeCalls: 0,
    sdkClientInputs: [] as Array<{
      baseUrl: string;
      directory: string;
      serverPassword?: string;
    }>,
    inventory: {
      providerList: { connected: [] as string[], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    } as unknown,
  },
  reset() {
    this.state.runVersionError = null;
    this.state.runVersionPending = false;
    this.state.versionStdout = DEFAULT_VERSION_STDOUT;
    this.state.inventoryError = null;
    this.state.connectionError = null;
    this.state.inventoryCwd = null;
    this.state.closeCalls = 0;
    this.state.sdkClientInputs.length = 0;
    this.state.inventory = {
      providerList: { connected: [], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    };
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: ({ serverPassword, environment }) =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          runtimeMock.state.closeCalls += 1;
        }),
      );
      const effectiveServerPassword = resolveOpenCodeServerPassword({
        external: false,
        ...(serverPassword !== undefined ? { serverPassword } : {}),
        ...(environment !== undefined ? { environment } : {}),
      });
      return {
        url: "http://127.0.0.1:4301",
        ...(effectiveServerPassword !== undefined
          ? { serverPassword: effectiveServerPassword }
          : {}),
        version: "1.14.19",
        isRunning: Effect.succeed(true),
        exitCode: Effect.never,
      };
    }),
  connectToOpenCodeServer: ({ serverUrl, serverPassword }) =>
    Effect.gen(function* () {
      if (runtimeMock.state.connectionError) {
        return yield* new OpenCodeRuntimeError({
          operation: "global.health",
          detail: runtimeMock.state.connectionError.message,
          cause: runtimeMock.state.connectionError,
        });
      }
      if (!serverUrl) {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            runtimeMock.state.closeCalls += 1;
          }),
        );
      }
      return {
        url: serverUrl ?? "http://127.0.0.1:4301",
        ...(serverPassword ? { serverPassword } : {}),
        version: "1.14.19",
        exitCode: null,
        external: Boolean(serverUrl),
      };
    }),
  runOpenCodeCommand: () =>
    runtimeMock.state.runVersionPending
      ? Effect.never
      : runtimeMock.state.runVersionError
        ? Effect.fail(
            new OpenCodeRuntimeError({
              operation: "runOpenCodeCommand",
              detail: runtimeMock.state.runVersionError.message,
              cause: runtimeMock.state.runVersionError,
            }),
          )
        : Effect.succeed({ stdout: runtimeMock.state.versionStdout, stderr: "", code: 0 }),
  createOpenCodeSdkClient: (input) => {
    runtimeMock.state.sdkClientInputs.push(input);
    return {} as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>;
  },
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
  loadOpenCodeSkills: () => Effect.succeed([]),
  loadSkillsFromCli: () => Effect.succeed([]),
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

const checkProvider = Effect.fn("checkProvider")(function* (
  settings: OpenCodeSettings,
  cwd = process.cwd(),
  environment?: NodeJS.ProcessEnv,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const serverOwner = yield* OpenCodeServerOwner.make({
        binaryPath: settings.binaryPath,
        directory: cwd,
        ...(settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
        ...(environment ? { environment } : {}),
      });
      return yield* checkOpenCodeProviderStatus(settings, cwd, environment).pipe(
        Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
      );
    }),
  );
});

it.layer(testLayer)("checkOpenCodeProviderStatus", (it) => {
  it.effect("shows a codex-style missing binary message", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("spawn opencode ENOENT");
      const snapshot = yield* checkProvider(makeOpenCodeSettings());

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
      const snapshot = yield* checkProvider(makeOpenCodeSettings());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.message, "Failed to execute OpenCode CLI health check.");
    }),
  );

  it.effect("times out a hanging local CLI version probe", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionPending = true;
      const probeFiber = yield* checkProvider(makeOpenCodeSettings()).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* TestClock.adjust("4 seconds");
      const snapshot = yield* Fiber.join(probeFiber);

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(
        snapshot.message,
        "Failed to execute OpenCode CLI health check: OpenCode CLI version probe timed out after 4 seconds.",
      );
    }).pipe(Effect.provide(TestClock.layer())),
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

      const snapshot = yield* checkProvider(makeOpenCodeSettings());
      const model = snapshot.models.find((entry) => entry.slug === "openai/gpt-5.4");

      NodeAssert.ok(model);
      const variantDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "variant" && descriptor.type === "select",
      );
      NodeAssert.ok(variantDescriptor && variantDescriptor.type === "select");
      NodeAssert.equal(variantDescriptor.label, "Reasoning");
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
          },
          {
            name: "openclaw-triage",
            description: "Triage OpenClaw routing issues.",
            location: "/Users/test/.agents/skills/openclaw-triage/SKILL.md",
          },
          {
            name: "missing-location",
            description: "This incomplete SDK row should be skipped.",
            location: "",
          },
        ],
      };

      const snapshot = yield* checkProvider(makeOpenCodeSettings());

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

  it.effect("loads local inventory from a scoped OpenCode server", () =>
    Effect.gen(function* () {
      yield* checkProvider(makeOpenCodeSettings({ serverPassword: "secret-password" }));

      NodeAssert.deepEqual(runtimeMock.state.sdkClientInputs, [
        {
          baseUrl: "http://127.0.0.1:4301",
          directory: process.cwd(),
          serverPassword: "secret-password",
        },
      ]);
      NodeAssert.equal(runtimeMock.state.closeCalls, 1);
      NodeAssert.equal(runtimeMock.state.inventoryCwd, null);
    }),
  );

  it.effect("uses an environment-only password for local inventory", () =>
    Effect.gen(function* () {
      yield* checkProvider(makeOpenCodeSettings(), process.cwd(), {
        OPENCODE_SERVER_PASSWORD: "environment-password",
      });

      NodeAssert.deepEqual(runtimeMock.state.sdkClientInputs, [
        {
          baseUrl: "http://127.0.0.1:4301",
          directory: process.cwd(),
          serverPassword: "environment-password",
        },
      ]);
    }),
  );

  it.effect("uses the settings password when local environment auth differs", () =>
    Effect.gen(function* () {
      yield* checkProvider(
        makeOpenCodeSettings({ serverPassword: "settings-password" }),
        process.cwd(),
        { OPENCODE_SERVER_PASSWORD: "environment-password" },
      );

      NodeAssert.equal(runtimeMock.state.sdkClientInputs[0]?.serverPassword, "settings-password");
    }),
  );

  it.effect("reports local model inventory failures without treating them as empty", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("opencode models failed");
      const snapshot = yield* checkProvider(makeOpenCodeSettings());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.models.length, 0);
      NodeAssert.equal(
        snapshot.message,
        "Failed to load OpenCode provider inventory: opencode models failed",
      );
    }),
  );
});

it.layer(testLayer)("checkOpenCodeProviderStatus with configured server URL", (it) => {
  it.effect("does not send a local environment password to a configured server", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings({ serverUrl: "http://127.0.0.1:9999" }),
        process.cwd(),
        { OPENCODE_SERVER_PASSWORD: "local-secret" },
      );

      NodeAssert.equal(snapshot.version, "1.14.19");
      NodeAssert.deepEqual(runtimeMock.state.sdkClientInputs, [
        {
          baseUrl: "http://127.0.0.1:9999",
          directory: process.cwd(),
        },
      ]);
    }),
  );

  it.effect("rejects an unsupported server before loading inventory", () =>
    Effect.gen(function* () {
      runtimeMock.state.connectionError = new Error(
        "OpenCode v1.14.18 is too old. Upgrade to v1.14.19 or newer.",
      );
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings({ serverUrl: "http://127.0.0.1:9999" }),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.models.length, 0);
      NodeAssert.match(snapshot.message ?? "", /v1\.14\.18 is too old/);
      NodeAssert.equal(runtimeMock.state.sdkClientInputs.length, 0);
    }),
  );

  it.effect("surfaces a friendly auth error for configured servers", () =>
    Effect.gen(function* () {
      runtimeMock.state.connectionError = new Error("401 Unauthorized");
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
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
      runtimeMock.state.connectionError = new Error(
        "fetch failed: connect ECONNREFUSED 127.0.0.1:9999",
      );
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
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
  it.effect("normalizes Go usage windows", () =>
    Effect.sync(() => {
      const usageLimits = normalizeOpenCodeGoUsage(goUsageMock.state.payload);
      NodeAssert.ok(usageLimits);
      const rolling = usageLimits.windows.find((window) => window.id === "rolling");
      const weekly = usageLimits.windows.find((window) => window.id === "weekly");
      const monthly = usageLimits.windows.find((window) => window.id === "monthly");
      NodeAssert.equal(rolling?.usedPercent, 13);
      NodeAssert.equal(rolling?.windowDurationMins, 5 * 60);
      NodeAssert.equal(rolling?.resetsAt, "2026-08-17T12:00:00.000Z");
      NodeAssert.equal(weekly?.usedPercent, 42);
      NodeAssert.equal(weekly?.windowDurationMins, 7 * 24 * 60);
      NodeAssert.equal(monthly?.usedPercent, 61);
      NodeAssert.equal(monthly?.windowDurationMins, 30 * 24 * 60);

      NodeAssert.equal(
        normalizeOpenCodeGoUsage({ usage: { weekly: { percent: -5 } } })?.windows[0]?.usedPercent,
        0,
      );
      NodeAssert.equal(
        normalizeOpenCodeGoUsage({ usage: { weekly: { percent: 140 } } })?.windows[0]?.usedPercent,
        100,
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.deepEqual(goUsageMock.state.requests, [
          {
            url: "https://opencode.ai/zen/go/v1/usage",
            authorization: "Bearer sk-test-go",
          },
        ]);
        const rolling = snapshot.usageLimits?.windows.find((window) => window.id === "rolling");
        const weekly = snapshot.usageLimits?.windows.find((window) => window.id === "weekly");
        const monthly = snapshot.usageLimits?.windows.find((window) => window.id === "monthly");
        NodeAssert.equal(rolling?.usedPercent, 13);
        NodeAssert.equal(rolling?.resetsAt, "2026-08-17T12:00:00.000Z");
        NodeAssert.equal(weekly?.usedPercent, 42);
        NodeAssert.equal(weekly?.windowDurationMins, 7 * 24 * 60);
        NodeAssert.equal(monthly?.usedPercent, 61);
        NodeAssert.equal(monthly?.windowDurationMins, 30 * 24 * 60);
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings(), process.cwd(), {
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
        NodeAssert.equal(
          snapshot.usageLimits?.windows.find((window) => window.id === "monthly")?.usedPercent,
          61,
        );
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.deepEqual(goUsageMock.state.requests, [
          {
            url: "https://opencode.ai/zen/go/v1/usage",
            authorization: "Bearer sk-file-go",
          },
        ]);
        NodeAssert.equal(
          snapshot.usageLimits?.windows.find((window) => window.id === "monthly")?.usedPercent,
          61,
        );
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 0);
        NodeAssert.equal(snapshot.usageLimits, undefined);
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 0);
        NodeAssert.equal(snapshot.usageLimits, undefined);
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

        const snapshot = yield* checkProvider(makeOpenCodeSettings());

        NodeAssert.equal(snapshot.status, "ready");
        NodeAssert.equal(goUsageMock.state.requests.length, 1);
        NodeAssert.equal(snapshot.usageLimits, undefined);
      } finally {
        cleanup();
      }
    }),
  );
});
