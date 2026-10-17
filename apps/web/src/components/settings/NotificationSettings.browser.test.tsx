import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  mode: "off",
  update: vi.fn(),
  requestPermission: vi.fn(async () => "granted"),
  supported: vi.fn(async () => true),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (select: (settings: { notificationMode: string }) => unknown) =>
    select({ notificationMode: state.mode }),
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("./settingsSearch", () => ({ searchableSetting: () => ({}) }));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({ description, control }: { description: ReactNode; control: ReactNode }) => (
    <div>
      {description}
      {control}
    </div>
  ),
}));
import { NotificationSettings } from "./NotificationSettings";

let root: Root;
let host: HTMLDivElement;
async function choose(value: string) {
  const labels: Record<string, string> = { off: "Off", notifications: "Notifications only" };
  await page.getByRole("combobox", { name: "Thread notifications" }).click();
  await page.getByRole("option", { name: labels[value]!, exact: true }).click();
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.mode = "off";
  state.supported.mockResolvedValue(true);
  state.requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: { notifications: { isSupported: state.supported } },
  });
  vi.stubGlobal("Notification", { requestPermission: state.requestPermission });
  await act(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    root.render(<NotificationSettings />);
  });
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, "desktopBridge", { configurable: true, value: undefined });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  vi.unstubAllGlobals();
});

it("enables native Linux notifications for remote HTTP without asking the browser", async () => {
  vi.stubGlobal("Notification", undefined);
  await choose("notifications");
  expect(state.supported).toHaveBeenCalledOnce();
  expect(state.requestPermission).not.toHaveBeenCalled();
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});

it("explains an unavailable native backend and allows retrying", async () => {
  state.supported.mockResolvedValue(false);
  await choose("notifications");
  expect(state.update).not.toHaveBeenCalled();
  expect(host.textContent).toContain("libnotify");
  state.supported.mockResolvedValue(true);
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});

it("can disable alerts even when the native service is unavailable", async () => {
  state.supported.mockRejectedValue(new Error("IPC unavailable"));
  await choose("notifications");
  expect(state.update).not.toHaveBeenCalled();
  state.mode = "notifications";
  await act(async () => root.render(<NotificationSettings />));
  await choose("off");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "off" });
});

it("still requires permission in the browser", async () => {
  Object.defineProperty(window, "desktopBridge", { configurable: true, value: undefined });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  state.requestPermission.mockResolvedValue("denied");
  await choose("notifications");
  expect(state.supported).not.toHaveBeenCalled();
  expect(state.requestPermission).toHaveBeenCalledOnce();
  expect(state.update).not.toHaveBeenCalled();
  state.requestPermission.mockResolvedValue("granted");
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});
