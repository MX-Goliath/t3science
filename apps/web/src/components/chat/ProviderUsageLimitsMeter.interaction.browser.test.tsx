import "~/index.css";
import {
  EnvironmentId,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, render } from "../../../test/render";
import { page } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

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
function setup() {
  state.consume.mockReset();
  state.notify.mockReset();
}

it("requires confirmation before consuming a weekly reset credit and shows its result", async () => {
  setup();
  using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-26T00:00:00Z"));
  await using screen = await render(meter());
  await screen.getByRole("button", { name: "Session Claude limit: 1% remaining" }).hover();
  await expect
    .element(page.getByRole("button", { name: "Use reset", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Weekly Claude limit: 5% remaining" }).hover();
  await expect
    .element(page.getByText("2 reset credits banked · next expires in 8d 7h"))
    .toBeVisible();
  await page.getByRole("button", { name: "Use reset", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Use credit", exact: true })).toBeVisible();
  expect(state.consume).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.consume).not.toHaveBeenCalled();

  let finish!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  state.consume.mockReturnValue(pending);
  await screen.getByRole("button", { name: "Weekly Claude limit: 5% remaining" }).hover();
  await page.getByRole("button", { name: "Use reset", exact: true }).click();
  await page.getByRole("button", { name: "Use credit", exact: true }).click();
  expect(state.consume).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { instanceId } });
  await act(() => finish(AsyncResult.success({ outcome: "reset" })));
  await vi.waitFor(() =>
    expect(state.notify).toHaveBeenCalledWith({
      type: "info",
      title: "Reset applied. Your windows have cleared.",
    }),
  );
  await screen.rerender(
    meter({ ...limits, windows: limits.windows.map((window) => ({ ...window, usedPercent: 0 })) }),
  );
  await screen.getByRole("button", { name: "Weekly Claude limit: 100% remaining" }).hover();
  await expect
    .element(page.getByRole("button", { name: "Use reset", exact: true }))
    .not.toBeInTheDocument();
});

it("drops pending confirmation when the selected provider changes", async () => {
  setup();
  await using screen = await render(meter());
  await screen.getByRole("button", { name: "Weekly Claude limit: 5% remaining" }).hover();
  await page.getByRole("button", { name: "Use reset", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Use credit", exact: true })).toBeVisible();
  await screen.rerender(meter(limits, ProviderInstanceId.make("another-account")));
  await expect
    .element(page.getByRole("button", { name: "Use credit", exact: true }))
    .not.toBeInTheDocument();
  expect(state.consume).not.toHaveBeenCalled();
});
