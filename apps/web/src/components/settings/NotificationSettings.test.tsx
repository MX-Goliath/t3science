import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  requestPermission: vi.fn(async () => "granted"),
  supported: vi.fn(async () => true),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (select: (settings: { notificationMode: string }) => unknown) =>
    select({ notificationMode: "off" }),
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
vi.mock("../ui/select", () => {
  const passthrough = ({ children }: { children: ReactNode }) => children;
  return {
    Select: passthrough,
    SelectItem: passthrough,
    SelectPopup: passthrough,
    SelectTrigger: passthrough,
    SelectValue: passthrough,
  };
});

import { Select } from "../ui/select";
import { NotificationSettings } from "./NotificationSettings";

let renderer: ReactTestRenderer;
async function choose(value: string) {
  await act(async () => {
    await renderer.root.findAllByType(Select)[0]!.props.onValueChange(value);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.supported.mockResolvedValue(true);
  state.requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    isSecureContext: false,
    desktopBridge: { notifications: { isSupported: state.supported } },
  });
  vi.stubGlobal("Notification", { requestPermission: state.requestPermission });
  await act(() => {
    renderer = create(<NotificationSettings />);
  });
});

afterEach(async () => {
  await act(() => renderer.unmount());
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
  expect(JSON.stringify(renderer.toJSON())).toContain("libnotify");
  state.supported.mockResolvedValue(true);
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});

it("can disable alerts even when the native service is unavailable", async () => {
  state.supported.mockRejectedValue(new Error("IPC unavailable"));
  await choose("notifications");
  expect(state.update).not.toHaveBeenCalled();
  await choose("off");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "off" });
});

it("still requires permission in the browser", async () => {
  vi.stubGlobal("window", { isSecureContext: true });
  state.requestPermission.mockResolvedValue("denied");
  await choose("notifications");
  expect(state.supported).not.toHaveBeenCalled();
  expect(state.requestPermission).toHaveBeenCalledOnce();
  expect(state.update).not.toHaveBeenCalled();
  state.requestPermission.mockResolvedValue("granted");
  await choose("notifications");
  expect(state.update).toHaveBeenCalledWith({ notificationMode: "notifications" });
});
