import { DesktopNotification } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  CLOSE_NOTIFICATION_CHANNEL,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFICATIONS_SUPPORTED_CHANNEL,
  SHOW_NOTIFICATION_CHANNEL,
} from "../channels.ts";

export const installNotifications = Effect.fn("desktop.ipc.installNotifications")(function* () {
  const platform = yield* HostProcessPlatform;
  if (platform !== "linux") return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const assets = yield* DesktopAssets.DesktopAssets;
  const icon = Option.getOrUndefined((yield* assets.iconPaths).png);
  const pending = new Map<string, Electron.Notification>();
  const owners = new Map<number, () => void>();
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const key = (senderId: number, id: string) => `${senderId}:${id}`;
  const close = (notificationKey: string) => {
    const notification = pending.get(notificationKey);
    if (!notification) return;
    pending.delete(notificationKey);
    notification.removeAllListeners();
    notification.close();
  };
  const clear = () => {
    for (const notificationKey of pending.keys()) close(notificationKey);
  };
  const watchOwner = (contents: Electron.WebContents) => {
    if (owners.has(contents.id)) return;
    const clearOwner = () => {
      for (const notificationKey of pending.keys()) {
        if (notificationKey.startsWith(`${contents.id}:`)) close(notificationKey);
      }
    };
    const onNavigate = (
      _event: Electron.Event,
      _url: string,
      inPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && !inPlace) clearOwner();
    };
    const dispose = () => {
      clearOwner();
      contents.removeListener("did-start-navigation", onNavigate);
      contents.removeListener("destroyed", dispose);
      owners.delete(contents.id);
    };
    contents.on("did-start-navigation", onNavigate);
    contents.on("destroyed", dispose);
    owners.set(contents.id, dispose);
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: NOTIFICATIONS_SUPPORTED_CHANNEL,
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: () => Effect.sync(() => Electron.Notification.isSupported()),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SHOW_NOTIFICATION_CHANNEL,
      payload: DesktopNotification,
      result: Schema.Boolean,
      handler: (input, event) =>
        Effect.sync(() => {
          const window = Electron.BrowserWindow.getAllWindows().find(
            (candidate) =>
              !candidate.isDestroyed() && candidate.webContents.id === event?.sender.id,
          );
          if (
            !window ||
            Electron.BrowserWindow.getFocusedWindow() ||
            !Electron.Notification.isSupported()
          )
            return false;
          watchOwner(window.webContents);
          const notificationKey = key(window.webContents.id, input.id);
          close(notificationKey);
          const notification = new Electron.Notification({
            title: input.title,
            // Plasma interprets notification bodies as markup; model output is plain text.
            body: input.body
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;"),
            ...(icon === undefined ? {} : { icon }),
            silent: true,
          });
          pending.set(notificationKey, notification);
          notification.on("click", () => {
            if (window.isDestroyed() || window.webContents.isDestroyed()) return;
            // Deliver navigation before focus clears the renderer's pending alerts.
            window.webContents.send(NOTIFICATION_CLICK_CHANNEL, input.id);
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            close(notificationKey);
          });
          notification.on("close", () => {
            if (pending.get(notificationKey) === notification) pending.delete(notificationKey);
          });
          notification.on("failed", (_event, error) => {
            close(notificationKey);
            runSync(Effect.logWarning("Could not show desktop notification", error));
          });
          try {
            notification.show();
          } catch (error) {
            close(notificationKey);
            runSync(Effect.logWarning("Could not show desktop notification", error));
            return false;
          }
          return true;
        }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: CLOSE_NOTIFICATION_CHANNEL,
      payload: DesktopNotification.fields.id,
      result: Schema.Void,
      handler: (id, event) =>
        Effect.sync(() => {
          if (event) close(key(event.sender.id, id));
        }),
    }),
  );
  yield* app.on("browser-window-focus", clear);
  yield* app.on("before-quit", clear);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      clear();
      for (const dispose of owners.values()) dispose();
    }),
  );
});
