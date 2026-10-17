import {
  EnvironmentId,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ consume: vi.fn(), notify: vi.fn() }));
vi.mock("../../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.consume }));
vi.mock("../../state/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/server")>()),
  serverEnvironment: { consumeResetCredit: "reset" },
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.notify } }));

vi.mock("../ui/popover", async () => {
  const { createContext, use, cloneElement } = await import("react");
  const Context = createContext({ open: false, setOpen: (_open: boolean) => {} });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) => <Context value={{ open, setOpen: onOpenChange }}>{children}</Context>,
    PopoverTrigger: ({
      render,
      children,
    }: {
      render: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
      children: ReactNode;
    }) => {
      const ctx = use(Context);
      return cloneElement(
        render,
        { onMouseEnter: () => ctx.setOpen(true), onClick: () => ctx.setOpen(!ctx.open) },
        children,
      );
    },
    PopoverPopup: ({ children }: { children: ReactNode }) =>
      use(Context).open ? <section data-popup>{children}</section> : null,
  };
});
vi.mock("../ui/alert-dialog", async () => {
  const { createContext, use, cloneElement } = await import("react");
  const Context = createContext((_open: boolean) => {});
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) => (open ? <Context value={onOpenChange}>{children}</Context> : null),
    AlertDialogClose: ({
      render,
      children,
    }: {
      render: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
      children: ReactNode;
    }) => {
      const setOpen = use(Context);
      return cloneElement(render, { onClick: () => setOpen(false) }, children);
    },
    AlertDialogPopup: ({ children }: { children: ReactNode }) => (
      <section role="alertdialog">{children}</section>
    ),
    AlertDialogHeader: "header",
    AlertDialogTitle: "h2",
    AlertDialogDescription: "p",
    AlertDialogFooter: "footer",
  };
});

import { ProviderUsageLimitsMeter } from "./ProviderUsageLimitsMeter";

const environmentId = EnvironmentId.make("remote-environment");
const instanceId = ProviderInstanceId.make("claude-work");
const limits: ServerProviderUsageLimits = {
  checkedAt: "2026-09-26T00:00:00Z",
  windows: [
    { id: "five_hour", kind: "session", label: "Session", usedPercent: 99 },
    { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 95 },
  ],
  resetCredits: { availableCount: 2, nextExpiresAt: "2026-10-04T07:00:00Z" },
};
let root: Root;
let host: HTMLDivElement;
function meter(nextLimits = limits, providerInstanceId = instanceId) {
  return (
    <ProviderUsageLimitsMeter
      environmentId={environmentId}
      instanceId={providerInstanceId}
      providerLabel="Claude"
      limits={nextLimits}
    />
  );
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
function hover(label: string) {
  const trigger = [...host.querySelectorAll("button")].find((node) =>
    node.getAttribute("aria-label")?.startsWith(label),
  )!;
  act(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-26T00:00:00Z"));
  state.consume.mockReset();
  state.notify.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(meter()));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("offers weekly credits on hover and keeps confirmation alive after the popover closes", async () => {
  hover("Session");
  expect(button("Use reset")).toBeUndefined();
  hover("Weekly");
  expect(host.textContent).toContain("2 reset credits banked · next expires in 8d 7h");
  expect(state.consume).not.toHaveBeenCalled();
  act(() => button("Use reset").click());
  expect(button("Use reset")).toBeUndefined();
  expect(button("Use credit")).toBeDefined();
  expect(state.consume).not.toHaveBeenCalled();
  act(() => button("Cancel").click());
  expect(button("Use credit")).toBeUndefined();
  expect(state.consume).not.toHaveBeenCalled();

  let finish!: (value: unknown) => void;
  state.consume.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  hover("Weekly");
  act(() => button("Use reset").click());
  act(() => button("Use credit").click());
  expect(state.consume).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { instanceId } });
  hover("Weekly");
  expect(button("Using…").disabled).toBe(true);
  await act(async () => {
    finish(AsyncResult.success({ outcome: "reset" }));
  });
  expect(state.notify).toHaveBeenCalledWith({
    type: "info",
    title: "Reset applied. Your windows have cleared.",
  });
  act(() =>
    root.render(
      meter({
        ...limits,
        windows: limits.windows.map((window) => ({ ...window, usedPercent: 0 })),
      }),
    ),
  );
  expect(button("Use reset")).toBeUndefined();
});

it("drops pending confirmation when the selected provider changes", () => {
  hover("Weekly");
  act(() => button("Use reset").click());
  act(() => root.render(meter(limits, ProviderInstanceId.make("another-account"))));
  expect(button("Use credit")).toBeUndefined();
  expect(state.consume).not.toHaveBeenCalled();
});
