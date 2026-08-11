import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { beforeEach, vi } from "vite-plus/test";

const electronMocks = vi.hoisted(() => {
  class MockTray {
    readonly listeners = new Map<string, () => void>();
    readonly destroy = vi.fn();
    readonly setContextMenu = vi.fn();
    readonly setToolTip = vi.fn();
    readonly on = vi.fn((eventName: string, listener: () => void) => {
      this.listeners.set(eventName, listener);
    });
  }

  return {
    MockTray,
    buildFromTemplate: vi.fn((template: unknown) => template),
    createFromPath: vi.fn(() => ({
      isEmpty: (): boolean => false,
      resize: () => ({ isEmpty: (): boolean => false }),
    })),
    setLoginItemSettings: vi.fn(),
    trays: [] as MockTray[],
  };
});

vi.mock("electron", () => ({
  app: {
    setLoginItemSettings: electronMocks.setLoginItemSettings,
  },
  Menu: {
    buildFromTemplate: electronMocks.buildFromTemplate,
  },
  nativeImage: {
    createFromPath: electronMocks.createFromPath,
  },
  Tray: class extends electronMocks.MockTray {
    constructor() {
      super();
      electronMocks.trays.push(this);
    }
  },
}));

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopSystemIntegration from "./DesktopSystemIntegration.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

interface Recording {
  readonly closeToTray: boolean[];
  readonly directories: string[];
  readonly removed: string[];
  readonly renamed: Array<{ from: string; to: string }>;
  readonly written: Array<{ path: string; content: string }>;
}

const emptyRecording = (): Recording => ({
  closeToTray: [],
  directories: [],
  removed: [],
  renamed: [],
  written: [],
});

function makeLayer(
  platform: "linux" | "win32",
  recording: Recording,
  initialSettings: DesktopAppSettings.DesktopSettings = DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
) {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    platform,
    isPackaged: true,
    appDataDirectory:
      platform === "linux" ? "/home/alice/.config" : "C:/Users/Alice/AppData/Roaming",
    appImagePath:
      platform === "linux"
        ? Option.some("/home/alice/Applications/T3 Science.AppImage")
        : Option.none(),
    displayName: "T3 Science (Alpha)",
    linuxDesktopEntryName: "t3science.desktop",
    path: { join: (...parts: readonly string[]) => parts.join("/") },
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  const desktopWindow = {
    activate: Effect.void,
    configureInitialVisibility: () => Effect.void,
    dispatchMenuAction: () => Effect.void,
    setCloseToTrayEnabled: (enabled: boolean) =>
      Effect.sync(() => recording.closeToTray.push(enabled)),
  } as unknown as DesktopWindow.DesktopWindow["Service"];

  const electronApp = {
    quit: Effect.void,
  } as unknown as ElectronApp.ElectronApp["Service"];

  return DesktopSystemIntegration.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        DesktopAppSettings.layerTest(initialSettings),
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
        Layer.succeed(DesktopWindow.DesktopWindow, desktopWindow),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        Layer.succeed(DesktopAssets.DesktopAssets, {
          iconPaths: Effect.succeed({
            ico: Option.some("C:/app/icon.ico"),
            icns: Option.none(),
            png: Option.some("/app/icon.png"),
          }),
          resolveResourcePath: () => Effect.succeed(Option.none()),
        }),
        FileSystem.layerNoop({
          makeDirectory: (path) => Effect.sync(() => recording.directories.push(path)),
          remove: (path) => Effect.sync(() => recording.removed.push(String(path))),
          rename: (from, to) =>
            Effect.sync(() => recording.renamed.push({ from: String(from), to: String(to) })),
          writeFileString: (path, content) =>
            Effect.sync(() => recording.written.push({ path: String(path), content })),
        }),
      ),
    ),
  );
}

describe("DesktopSystemIntegration", () => {
  beforeEach(() => {
    electronMocks.trays.length = 0;
    electronMocks.buildFromTemplate.mockClear();
    electronMocks.createFromPath.mockClear();
    electronMocks.setLoginItemSettings.mockClear();
  });

  it("renders a KDE-compatible XDG autostart entry with the AppImage path quoted", () => {
    const entry = DesktopSystemIntegration.renderLinuxAutostartDesktopEntry({
      displayName: "T3 Science (Alpha)",
      execTarget: "/home/alice/Applications/T3 Science.AppImage",
    });

    assert.include(entry, "[Desktop Entry]");
    assert.include(entry, "Type=Application");
    assert.include(entry, 'Exec="/home/alice/Applications/T3 Science.AppImage"');
    assert.include(entry, "X-GNOME-Autostart-enabled=true");
    assert.include(entry, "StartupNotify=false");
  });

  it.effect("creates and removes the Linux tray and XDG autostart registration", () => {
    const recording = emptyRecording();

    return Effect.scoped(
      Effect.gen(function* () {
        const integration = yield* DesktopSystemIntegration.DesktopSystemIntegration;
        const enabled = yield* integration.setSettings({
          closeToTray: true,
          launchAtLogin: true,
          startInTray: true,
        });

        assert.deepEqual(enabled.settings, {
          closeToTray: true,
          launchAtLogin: true,
          startInTray: true,
        });
        assert.isTrue(enabled.supported);
        assert.isTrue(enabled.launchAtLoginSupported);
        assert.isTrue(yield* integration.shouldStartInTray);
        assert.equal(electronMocks.trays.length, 1);
        assert.deepEqual(recording.closeToTray, [true]);
        assert.deepEqual(recording.directories, ["/home/alice/.config/autostart"]);
        assert.equal(recording.written.length, 1);
        assert.include(
          recording.written[0]?.content,
          'Exec="/home/alice/Applications/T3 Science.AppImage"',
        );
        assert.deepEqual(recording.renamed, [
          {
            from: `/home/alice/.config/autostart/t3science.desktop.${process.pid}.tmp`,
            to: "/home/alice/.config/autostart/t3science.desktop",
          },
        ]);

        const tray = electronMocks.trays[0];
        assert.exists(tray);
        assert.equal(tray.setToolTip.mock.calls[0]?.[0], "T3 Science (Alpha)");
        const menuBuildCall = electronMocks.buildFromTemplate.mock.calls[0];
        assert.exists(menuBuildCall);
        const menuTemplate = menuBuildCall[0] as Array<{ label?: string }>;
        assert.deepEqual(
          menuTemplate.map((item) => item.label),
          ["Open T3 Science (Alpha)", "Settings...", undefined, "Quit"],
        );

        const disabled = yield* integration.setSettings({
          closeToTray: false,
          launchAtLogin: false,
          startInTray: false,
        });
        assert.deepEqual(disabled.settings, {
          closeToTray: false,
          launchAtLogin: false,
          startInTray: false,
        });
        assert.isFalse(yield* integration.shouldStartInTray);
        assert.equal(tray.destroy.mock.calls.length, 1);
        assert.deepEqual(recording.closeToTray, [true, false]);
        assert.include(recording.removed, "/home/alice/.config/autostart/t3science.desktop");
      }).pipe(Effect.provide(makeLayer("linux", recording))),
    );
  });

  it.effect("uses the native Windows login-item registration", () => {
    const recording = emptyRecording();

    return Effect.scoped(
      Effect.gen(function* () {
        const integration = yield* DesktopSystemIntegration.DesktopSystemIntegration;
        yield* integration.setSettings({
          closeToTray: false,
          launchAtLogin: true,
          startInTray: false,
        });
        yield* integration.setSettings({
          closeToTray: false,
          launchAtLogin: false,
          startInTray: false,
        });

        assert.deepEqual(electronMocks.setLoginItemSettings.mock.calls, [
          [{ openAtLogin: true, path: process.execPath }],
          [{ openAtLogin: false, path: process.execPath }],
        ]);
        assert.deepEqual(recording.written, []);
        assert.equal(electronMocks.trays.length, 0);
      }).pipe(Effect.provide(makeLayer("win32", recording))),
    );
  });

  it.effect("opens normally and disables close-to-tray when the tray cannot be created", () => {
    const recording = emptyRecording();
    electronMocks.createFromPath.mockReturnValueOnce({
      isEmpty: () => true,
      resize: () => ({ isEmpty: () => true }),
    });
    const initialSettings = {
      ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
      closeToTray: true,
      startInTray: true,
    };

    return Effect.scoped(
      Effect.gen(function* () {
        const integration = yield* DesktopSystemIntegration.DesktopSystemIntegration;
        yield* integration.configure;

        const state = yield* integration.getState;
        assert.isFalse(state.settings.closeToTray);
        assert.isTrue(state.settings.startInTray);
        assert.isFalse(yield* integration.shouldStartInTray);
        assert.deepEqual(recording.closeToTray, [false]);
        assert.equal(electronMocks.trays.length, 0);
      }).pipe(Effect.provide(makeLayer("linux", recording, initialSettings))),
    );
  });
});
