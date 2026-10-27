import type { ReactNode } from "react";
import { render, stubGlobal } from "../../../test/render";
import { page } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

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

async function choose(value: string) {
  const labels: Record<string, string> = { off: "Off", notifications: "Notifications only" };
  await page.getByRole("combobox", { name: "Thread notifications" }).click();
  await page.getByRole("option", { name: labels[value]!, exact: true }).click();
}

function setup() {
  vi.clearAllMocks();
  state.mode = "off";
  state.supported.mockResolvedValue(true);
  state.requestPermission.mockResolvedValue("granted");
}
function nativeBridge() {
  const stack = new DisposableStack();
  stack.use(stubGlobal("isSecureContext", false));
  stack.use(stubGlobal("desktopBridge", { notifications: { isSupported: state.supported } }));
  stack.use(stubGlobal("Notification", { requestPermission: state.requestPermission }));
  return stack;
}

it("enables native Linux notifications for remote HTTP without asking the browser", async () => {
  setup();
  using _native = nativeBridge();
  await using _screen = await render(<NotificationSettings />);
  using _notification = stubGlobal("Notification", undefined);
  await choose("notifications");
  expect(state.supported).toHaveBeenCalledOnce();
  expect(state.requestPermission).not.toHaveBeenCalled();
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});

it("explains an unavailable native backend and allows retrying", async () => {
  setup();
  using _native = nativeBridge();
  await using screen = await render(<NotificationSettings />);
  state.supported.mockResolvedValue(false);
  await choose("notifications");
  expect(state.update).not.toHaveBeenCalled();
  await expect.element(screen.getByText(/libnotify/)).toBeVisible();
  state.supported.mockResolvedValue(true);
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});

it("can disable alerts even when the native service is unavailable", async () => {
  setup();
  using _native = nativeBridge();
  await using screen = await render(<NotificationSettings />);
  state.supported.mockRejectedValue(new Error("IPC unavailable"));
  await choose("notifications");
  expect(state.update).not.toHaveBeenCalled();
  state.mode = "notifications";
  await screen.rerender(<NotificationSettings />);
  await choose("off");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "off" });
});

it("still requires permission in the browser", async () => {
  setup();
  using _bridge = stubGlobal("desktopBridge", undefined);
  using _secure = stubGlobal("isSecureContext", true);
  using _notification = stubGlobal("Notification", { requestPermission: state.requestPermission });
  await using _screen = await render(<NotificationSettings />);
  state.requestPermission.mockResolvedValue("denied");
  await choose("notifications");
  expect(state.supported).not.toHaveBeenCalled();
  expect(state.requestPermission).toHaveBeenCalledOnce();
  expect(state.update).not.toHaveBeenCalled();
  state.requestPermission.mockResolvedValue("granted");
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});
