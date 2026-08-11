import type {
  DesktopSystemIntegrationSettings as SystemIntegrationSettings,
  DesktopSystemIntegrationState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { escapeDesktopEntryExecArgument } from "./DesktopLinuxUrlHandler.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

const SystemIntegrationOperation = Schema.Literals([
  "create-tray",
  "configure-tray",
  "set-windows-login-item",
  "write-linux-autostart",
  "remove-linux-autostart",
  "unsupported-platform",
]);

export class DesktopSystemIntegrationError extends Schema.TaggedErrorClass<DesktopSystemIntegrationError>()(
  "DesktopSystemIntegrationError",
  {
    operation: SystemIntegrationOperation,
    platform: Schema.String,
    path: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const path = this.path === undefined ? "" : ` at ${this.path}`;
    return `Desktop system integration failed during ${this.operation}${path} on ${this.platform}.`;
  }
}

export class DesktopSystemIntegration extends Context.Service<
  DesktopSystemIntegration,
  {
    readonly configure: Effect.Effect<void>;
    readonly getState: Effect.Effect<DesktopSystemIntegrationState>;
    readonly setSettings: (
      settings: SystemIntegrationSettings,
    ) => Effect.Effect<
      DesktopSystemIntegrationState,
      DesktopSystemIntegrationError | DesktopAppSettings.DesktopSettingsWriteError
    >;
    readonly shouldStartInTray: Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/app/DesktopSystemIntegration") {}

const { logInfo, logWarning } = makeComponentLogger("desktop-system-integration");

const pickSystemIntegrationSettings = (
  settings: DesktopAppSettings.DesktopSettings,
): SystemIntegrationSettings => ({
  closeToTray: settings.closeToTray,
  launchAtLogin: settings.launchAtLogin,
  startInTray: settings.startInTray,
});

const needsTray = (settings: SystemIntegrationSettings): boolean =>
  settings.closeToTray || settings.startInTray;

export function renderLinuxAutostartDesktopEntry(input: {
  readonly displayName: string;
  readonly execTarget: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    `Name=${input.displayName.replaceAll("\n", " ").replaceAll("\r", " ")}`,
    `Exec=${escapeDesktopEntryExecArgument(input.execTarget)}`,
    "Terminal=false",
    "StartupNotify=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export const make = Effect.gen(function* () {
  const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const context = yield* Effect.context<DesktopWindow.DesktopWindow | ElectronApp.ElectronApp>();
  const runPromise = Effect.runPromiseWith(context);
  const supported = environment.platform === "win32" || environment.platform === "linux";
  const launchAtLoginSupported = supported && environment.isPackaged;
  const linuxAutostartDirectory = environment.path.join(environment.appDataDirectory, "autostart");
  const linuxAutostartPath = environment.path.join(
    linuxAutostartDirectory,
    environment.linuxDesktopEntryName,
  );
  let tray: Electron.Tray | undefined;

  const runTrayAction = <E>(name: string, effect: Effect.Effect<void, E>) => {
    void runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          logWarning("tray action failed", { action: name, cause: String(cause) }),
        ),
      ),
    );
  };

  const destroyTray = Effect.sync(() => {
    tray?.destroy();
    tray = undefined;
  });

  yield* Effect.addFinalizer(() => destroyTray);

  const ensureTray = Effect.gen(function* () {
    if (tray !== undefined || !supported) return;
    const iconPaths = yield* assets.iconPaths;
    const iconPath =
      environment.platform === "win32"
        ? Option.getOrElse(iconPaths.ico, () => Option.getOrUndefined(iconPaths.png))
        : Option.getOrUndefined(iconPaths.png);
    if (iconPath === undefined) {
      return yield* new DesktopSystemIntegrationError({
        operation: "create-tray",
        platform: environment.platform,
        cause: new Error("No platform tray icon is available."),
      });
    }

    const createdTray = yield* Effect.try({
      try: () => {
        const sourceImage = Electron.nativeImage.createFromPath(iconPath);
        const trayImage =
          environment.platform === "linux"
            ? sourceImage.resize({ width: 22, height: 22, quality: "best" })
            : sourceImage;
        if (trayImage.isEmpty()) {
          throw new Error(`Tray icon is empty: ${iconPath}`);
        }
        return new Electron.Tray(trayImage);
      },
      catch: (cause) =>
        new DesktopSystemIntegrationError({
          operation: "create-tray",
          platform: environment.platform,
          path: iconPath,
          cause,
        }),
    });

    yield* Effect.try({
      try: () => {
        const openWindow = () => runTrayAction("open", desktopWindow.activate);
        const openSettings = () =>
          runTrayAction(
            "open-settings",
            desktopWindow.activate.pipe(
              Effect.andThen(desktopWindow.dispatchMenuAction("open-settings")),
            ),
          );
        const quit = () => runTrayAction("quit", electronApp.quit);
        const menu = Electron.Menu.buildFromTemplate([
          {
            label: `Open ${environment.displayName}`,
            click: openWindow,
          },
          { label: "Settings...", click: openSettings },
          { type: "separator" },
          { label: "Quit", click: quit },
        ]);
        createdTray.setToolTip(environment.displayName);
        createdTray.setContextMenu(menu);
        createdTray.on("click", openWindow);
        tray = createdTray;
      },
      catch: (cause) => {
        createdTray.destroy();
        return new DesktopSystemIntegrationError({
          operation: "configure-tray",
          platform: environment.platform,
          path: iconPath,
          cause,
        });
      },
    });
    yield* logInfo("tray enabled", { platform: environment.platform });
  });

  const reconcileTray = Effect.fn("desktop.systemIntegration.reconcileTray")(function* (
    settings: SystemIntegrationSettings,
  ) {
    if (needsTray(settings)) {
      yield* ensureTray;
      yield* desktopWindow.setCloseToTrayEnabled(settings.closeToTray);
      return;
    }
    yield* desktopWindow.setCloseToTrayEnabled(false);
    yield* destroyTray;
    yield* logInfo("tray disabled", { platform: environment.platform });
  });

  const setLinuxAutostart = Effect.fn("desktop.systemIntegration.setLinuxAutostart")(function* (
    enabled: boolean,
  ) {
    if (enabled) {
      const execTarget = Option.getOrElse(environment.appImagePath, () => process.execPath);
      const tempPath = `${linuxAutostartPath}.${process.pid}.tmp`;
      yield* Effect.gen(function* () {
        yield* fileSystem.makeDirectory(linuxAutostartDirectory, { recursive: true });
        yield* fileSystem.writeFileString(
          tempPath,
          renderLinuxAutostartDesktopEntry({
            displayName: environment.displayName,
            execTarget,
          }),
        );
        yield* fileSystem.rename(tempPath, linuxAutostartPath);
      }).pipe(
        Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)),
        Effect.mapError(
          (cause) =>
            new DesktopSystemIntegrationError({
              operation: "write-linux-autostart",
              platform: environment.platform,
              path: linuxAutostartPath,
              cause,
            }),
        ),
      );
      return;
    }

    yield* fileSystem.remove(linuxAutostartPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopSystemIntegrationError({
            operation: "remove-linux-autostart",
            platform: environment.platform,
            path: linuxAutostartPath,
            cause,
          }),
      ),
    );
  });

  const setLaunchAtLogin = Effect.fn("desktop.systemIntegration.setLaunchAtLogin")(function* (
    enabled: boolean,
  ) {
    if (!launchAtLoginSupported) {
      if (!enabled) return;
      return yield* new DesktopSystemIntegrationError({
        operation: "unsupported-platform",
        platform: environment.platform,
        cause: new Error("Launch at login is only available in packaged Windows/Linux builds."),
      });
    }

    if (environment.platform === "linux") {
      yield* setLinuxAutostart(enabled);
      return;
    }

    yield* Effect.try({
      try: () => {
        Electron.app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
        });
      },
      catch: (cause) =>
        new DesktopSystemIntegrationError({
          operation: "set-windows-login-item",
          platform: environment.platform,
          path: process.execPath,
          cause,
        }),
    });
  });

  const readSettings = appSettings.get.pipe(Effect.map(pickSystemIntegrationSettings));

  const getState = readSettings.pipe(
    Effect.map(
      (settings): DesktopSystemIntegrationState => ({
        supported,
        launchAtLoginSupported,
        settings,
      }),
    ),
  );

  const configure = Effect.gen(function* () {
    const settings = yield* readSettings;
    if (!supported) {
      return;
    }
    yield* reconcileTray(settings).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* desktopWindow.setCloseToTrayEnabled(false);
          if (settings.closeToTray) {
            yield* appSettings
              .setSystemIntegration({ ...settings, closeToTray: false })
              .pipe(Effect.ignore);
          }
          yield* logWarning("failed to configure tray; close-to-tray was disabled", {
            message: error.message,
          });
        }),
      ),
    );
    yield* setLaunchAtLogin(settings.launchAtLogin).pipe(
      Effect.catch((error) =>
        logWarning("failed to reconcile launch-at-login registration", {
          message: error.message,
        }),
      ),
    );
  }).pipe(Effect.withSpan("desktop.systemIntegration.configure"));

  const setSettings = Effect.fn("desktop.systemIntegration.setSettings")(function* (
    requested: SystemIntegrationSettings,
  ) {
    if (!supported && needsTray(requested)) {
      return yield* new DesktopSystemIntegrationError({
        operation: "unsupported-platform",
        platform: environment.platform,
      });
    }
    if (!launchAtLoginSupported && requested.launchAtLogin) {
      return yield* new DesktopSystemIntegrationError({
        operation: "unsupported-platform",
        platform: environment.platform,
      });
    }

    const previous = yield* readSettings;
    const change = yield* appSettings.setSystemIntegration(requested);
    if (!change.changed) {
      return yield* getState;
    }

    yield* Effect.gen(function* () {
      yield* reconcileTray(requested);
      if (previous.launchAtLogin !== requested.launchAtLogin) {
        yield* setLaunchAtLogin(requested.launchAtLogin);
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* appSettings.setSystemIntegration(previous).pipe(Effect.ignore);
          yield* reconcileTray(previous).pipe(Effect.ignore);
          if (previous.launchAtLogin !== requested.launchAtLogin) {
            yield* setLaunchAtLogin(previous.launchAtLogin).pipe(Effect.ignore);
          }
          return yield* error;
        }),
      ),
    );

    return yield* getState;
  });

  return DesktopSystemIntegration.of({
    configure,
    getState,
    setSettings,
    shouldStartInTray: Effect.gen(function* () {
      const settings = yield* readSettings;
      return supported && settings.startInTray && tray !== undefined;
    }),
  });
});

export const layer = Layer.effect(DesktopSystemIntegration, make);
