import * as NodeEvents from "node:events";
import { it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { beforeEach, expect, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  supported: vi.fn(() => true),
  isFocused: vi.fn(() => false),
  isDestroyed: vi.fn(() => false),
  isMinimized: vi.fn(() => true),
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  webContents: {
    id: 1,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  listeners: new Map<string, () => void>(),
}));

class TestNotification extends NodeEvents.EventEmitter {
  static sent: TestNotification[] = [];
  static isSupported = native.supported;
  show = vi.fn();
  close = vi.fn();
  readonly options: Electron.NotificationConstructorOptions;
  constructor(options: Electron.NotificationConstructorOptions) {
    super();
    this.options = options;
    TestNotification.sent.push(this);
  }
}

vi.mock("electron", () => ({
  get Notification() {
    return TestNotification;
  },
  app: {
    on: (event: string, listener: () => void) => native.listeners.set(event, listener),
    removeListener: (event: string) => native.listeners.delete(event),
  },
  BrowserWindow: {
    getAllWindows: () => [native],
    getFocusedWindow: () => (native.isFocused() ? native : null),
  },
}));

import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  CLOSE_NOTIFICATION_CHANNEL,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFICATIONS_SUPPORTED_CHANNEL,
  SHOW_NOTIFICATION_CHANNEL,
} from "../channels.ts";
import { installNotifications } from "./notifications.ts";

const input = { id: "notification-1", title: "Thread completed", body: "Fix login" };
const icon = "/tmp/.mount_t3science/resources/icon.png";

const withNotifications = Effect.fnUntraced(function* (
  run: (
    invoke: (channel: string, payload?: unknown, senderId?: number) => Promise<unknown>,
  ) => Promise<void>,
  platform: NodeJS.Platform = "linux",
) {
  const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* installNotifications();
      yield* Effect.promise(() =>
        run(async (channel, payload, senderId = 1) => {
          const handler = handlers.get(channel);
          if (!handler) throw new Error("Missing IPC handler");
          return handler({ sender: { id: senderId } }, payload);
        }),
      );
    }),
  ).pipe(
    Effect.provideService(HostProcessPlatform, platform),
    Effect.provideService(DesktopAssets.DesktopAssets, {
      iconPaths: Effect.succeed({
        png: Option.some(icon),
        ico: Option.none(),
        icns: Option.none(),
      }),
      resolveResourcePath: () => Effect.succeedNone,
    }),
    Effect.provide([
      ElectronApp.layer,
      DesktopIpc.layer({
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
        removeHandler: (channel) => {
          handlers.delete(channel);
        },
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      }),
    ]),
  );
  expect(handlers.size).toBe(0);
  expect(native.listeners.size).toBe(0);
});

beforeEach(() => {
  vi.clearAllMocks();
  TestNotification.sent = [];
  native.supported.mockReturnValue(true);
  native.isFocused.mockReturnValue(false);
  native.isDestroyed.mockReturnValue(false);
  native.isMinimized.mockReturnValue(true);
  native.focus.mockImplementation(() => native.listeners.get("browser-window-focus")?.());
  native.listeners.clear();
});

it.effect("uses the packaged AppImage icon and restores the window after sending navigation", () =>
  withNotifications(async (invoke) => {
    expect(await invoke(NOTIFICATIONS_SUPPORTED_CHANNEL)).toBe(true);
    expect(await invoke(SHOW_NOTIFICATION_CHANNEL, input)).toBe(true);
    const notification = TestNotification.sent[0]!;
    expect(notification.options).toEqual({
      title: input.title,
      body: input.body,
      silent: true,
      icon,
    });
    expect(notification.show).toHaveBeenCalledOnce();
    notification.emit("click");
    expect(native.webContents.send).toHaveBeenCalledWith(NOTIFICATION_CLICK_CHANNEL, input.id);
    expect(native.webContents.send.mock.invocationCallOrder[0]).toBeLessThan(
      native.focus.mock.invocationCallOrder[0]!,
    );
    expect(native.restore).toHaveBeenCalledOnce();
    expect(native.show).toHaveBeenCalledOnce();
    expect(native.focus).toHaveBeenCalledOnce();
    expect(notification.close).toHaveBeenCalledOnce();
  }),
);

it.effect("rejects invalid payloads before creating native notifications", () =>
  withNotifications(async (invoke) => {
    for (const invalid of [
      { ...input, id: "" },
      { ...input, title: 42 },
      { ...input, body: "x".repeat(4097) },
    ]) {
      await expect(invoke(SHOW_NOTIFICATION_CHANNEL, invalid)).rejects.toBeDefined();
    }
    expect(TestNotification.sent).toHaveLength(0);
  }),
);

it.effect("presents model code as text rather than Plasma notification markup", () =>
  withNotifications(async (invoke) => {
    await invoke(SHOW_NOTIFICATION_CHANNEL, { ...input, body: "Changed <input> & <button>" });
    expect(TestNotification.sent[0]!.options.body).toBe(
      "Changed &lt;input&gt; &amp; &lt;button&gt;",
    );
  }),
);

it.effect("does not show alerts for a focused, missing, destroyed, or unsupported window", () =>
  withNotifications(async (invoke) => {
    expect(await invoke(SHOW_NOTIFICATION_CHANNEL, input, 999)).toBe(false);
    native.isFocused.mockReturnValue(true);
    expect(await invoke(SHOW_NOTIFICATION_CHANNEL, input)).toBe(false);
    native.isFocused.mockReturnValue(false);
    native.isDestroyed.mockReturnValue(true);
    expect(await invoke(SHOW_NOTIFICATION_CHANNEL, input)).toBe(false);
    native.isDestroyed.mockReturnValue(false);
    native.supported.mockReturnValue(false);
    expect(await invoke(NOTIFICATIONS_SUPPORTED_CHANNEL)).toBe(false);
    expect(await invoke(SHOW_NOTIFICATION_CHANNEL, input)).toBe(false);
    expect(TestNotification.sent).toHaveLength(0);
  }),
);

it.effect("replaces duplicate ids and only lets the owning renderer close an alert", () =>
  withNotifications(async (invoke) => {
    await invoke(SHOW_NOTIFICATION_CHANNEL, input);
    await invoke(SHOW_NOTIFICATION_CHANNEL, input);
    const [first, second] = TestNotification.sent;
    expect(first!.close).toHaveBeenCalledOnce();
    await invoke(CLOSE_NOTIFICATION_CHANNEL, input.id, 999);
    expect(second!.close).not.toHaveBeenCalled();
    await invoke(CLOSE_NOTIFICATION_CHANNEL, input.id);
    expect(second!.close).toHaveBeenCalledOnce();
    second!.emit("click");
    expect(native.focus).not.toHaveBeenCalled();
  }),
);

it.effect.each(["browser-window-focus", "before-quit"])("clears alerts on %s", (event) =>
  withNotifications(async (invoke) => {
    await invoke(SHOW_NOTIFICATION_CHANNEL, input);
    native.listeners.get(event)!();
    expect(TestNotification.sent[0]!.close).toHaveBeenCalledOnce();
  }),
);

it.effect("disposes remaining notifications with the IPC scope", () =>
  Effect.gen(function* () {
    yield* withNotifications(async (invoke) => {
      await invoke(SHOW_NOTIFICATION_CHANNEL, input);
    });
    expect(TestNotification.sent[0]!.close).toHaveBeenCalledOnce();
  }),
);

it.effect("cleans up failed notifications", () =>
  withNotifications(async (invoke) => {
    await invoke(SHOW_NOTIFICATION_CHANNEL, input);
    TestNotification.sent[0]!.emit("failed", {}, "Notification service unavailable");
    expect(TestNotification.sent[0]!.close).toHaveBeenCalledOnce();
  }),
);

it.effect("closes alerts on renderer reload but keeps them during in-app navigation", () =>
  Effect.gen(function* () {
    yield* withNotifications(async (invoke) => {
      await invoke(SHOW_NOTIFICATION_CHANNEL, input);
      await invoke(SHOW_NOTIFICATION_CHANNEL, { ...input, id: "second" });
      const navigate = native.webContents.on.mock.calls.find(
        ([event]) => event === "did-start-navigation",
      )![1];
      navigate({}, "https://example.com", false, false);
      navigate({}, "https://example.com/thread", true, true);
      expect(TestNotification.sent[0]!.close).not.toHaveBeenCalled();
      navigate({}, "https://example.com", false, true);
      expect(
        TestNotification.sent.every((notification) => notification.close.mock.calls.length === 1),
      ).toBe(true);
      expect(native.webContents.on).toHaveBeenCalledTimes(2);
    });
    expect(native.webContents.removeListener).toHaveBeenCalledTimes(2);
  }),
);

it.effect("closes alerts when the owning window is destroyed", () =>
  Effect.gen(function* () {
    yield* withNotifications(async (invoke) => {
      await invoke(SHOW_NOTIFICATION_CHANNEL, input);
      const destroy = native.webContents.on.mock.calls.find(([event]) => event === "destroyed")![1];
      destroy();
      expect(TestNotification.sent[0]!.close).toHaveBeenCalledOnce();
    });
    expect(native.webContents.removeListener).toHaveBeenCalledTimes(2);
  }),
);

it.effect.each(["darwin", "win32"] as const)("keeps the existing renderer path on %s", (platform) =>
  Effect.gen(function* () {
    yield* withNotifications(async (invoke) => {
      await expect(invoke(SHOW_NOTIFICATION_CHANNEL, input)).rejects.toThrow("Missing IPC handler");
    }, platform);
    expect(native.supported).not.toHaveBeenCalled();
  }),
);
