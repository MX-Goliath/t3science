import "~/index.css";

import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ThreadId,
  type SystemResourcesSnapshot,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { serverEnvironment } from "../../state/server";
import { PopoverCreateHandle } from "../ui/popover";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout } from "./chatCanvasLayout";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsSystemResources } from "./ThreadDetailsSystemResources";

vi.mock("../../state/server", () => ({ serverEnvironment: { systemResources: vi.fn() } }));
vi.mock("../../state/clientHostEnvironment", () => ({
  clientHostEnvironmentAtom: () => Atom.make(false),
}));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({
    connection: { phase: "connected" },
    serverConfig: { environment: { capabilities: { systemResources: true } } },
  }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: ((
    _environmentId: unknown,
    selector: (settings: UnifiedSettings) => unknown,
  ) => selector(DEFAULT_UNIFIED_SETTINGS)) as never,
}));

function setup() {
  const threadRef = {
    environmentId: EnvironmentId.make("resource-browser"),
    threadId: ThreadId.make("resource-thread"),
  };
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  const scheduled: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.push(task);
      return () => {};
    },
  });
  let reads = 0;
  let activeReads = 0;
  const query = Atom.make((get) => {
    reads++;
    activeReads++;
    get.addFinalizer(() => activeReads--);
    const snapshot: SystemResourcesSnapshot = {
      supported: true,
      sampledAt: reads * 2_000,
      cpu: { utilization: 0.38, coreCount: 16, frequencyMhz: 3200, temperatureCelsius: 60 },
      memory: { usedBytes: 32 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 },
      gpus: ["amd", "nvidia"].map((vendor, index) => ({
        id: `gpu-${index}`,
        name: index === 0 ? "AMD Radeon RX 7900 XTX" : "NVIDIA GeForce RTX 4090",
        vendor: vendor === "amd" ? "amd" : "nvidia",
        utilization: 0.47,
        temperatureCelsius: 47,
        memoryUsedBytes: 8 * 1024 ** 3,
        memoryTotalBytes: 24 * 1024 ** 3,
      })),
      disks: Array.from({ length: 12 }, (_, index) => ({
        id: `disk-${index}`,
        label: `Local disk ${index}`,
        mountPath: index === 0 ? "/" : `/mnt/external-storage-with-a-long-name-${index}`,
        usedBytes: 750 * 1024 ** 3,
        totalBytes: 1000 * 1024 ** 3,
      })),
    };
    return AsyncResult.success(snapshot);
  }).pipe(Atom.setIdleTTL(0));
  vi.mocked(serverEnvironment.systemResources).mockReset().mockReturnValue(query);
  const anchor = document.createElement("div");
  anchor.style.cssText = "position:fixed;top:10px;left:0;width:600px;height:40px";
  document.body.append(anchor);
  return {
    threadRef,
    registry,
    anchor: { current: anchor },
    handle: PopoverCreateHandle(),
    reads: () => reads,
    activeReads: () => activeReads,
    flush: () => {
      for (const task of scheduled.splice(0)) task();
    },
    [Symbol.dispose]() {
      registry.dispose();
      anchor.remove();
    },
  };
}

it("fits and scrolls remote resources and polls only while both the card and section are open", async () => {
  using fixture = setup();
  const container = { width: 1200, height: 800 };
  const placement = { x: 908, y: 0, right: 12, width: 280, height: 400 } as const;
  await using screen = await render(
    <RegistryContext value={fixture.registry}>
      <ChatCanvasContext
        value={{
          container,
          lane: { padding: 48, minChatWidth: 640 },
          layout: resolveChatCanvasLayout({ container, preview: null }),
          previewKey: null,
          registerTimeline: () => {},
          measureDetailsCard: () => {},
          detailsCardTopInset: 0,
          preferredDetailsCard: placement,
          detailsCardPlacement: null,
        }}
      >
        <ThreadDetailsCard
          threadRef={fixture.threadRef}
          anchor={fixture.anchor}
          handle={fixture.handle}
          contentKey="resources"
        >
          {(_density, open) =>
            open ? (
              <ThreadDetailsSystemResources environmentId={fixture.threadRef.environmentId} />
            ) : null
          }
        </ThreadDetailsCard>
      </ChatCanvasContext>
    </RegistryContext>,
  );
  using _timers = fakeTimers();
  expect(fixture.reads()).toBe(0);
  await act(() =>
    useRightPanelStore.getState().setThreadPanelOpen(fixture.threadRef, "popover", true),
  );
  await expect.element(page.getByText("AMD Radeon RX 7900 XTX")).toBeVisible();
  await expect.element(page.getByText("NVIDIA GeForce RTX 4090")).toBeVisible();
  await expect
    .element(page.getByText("external-storage-with-a-long-name-11", { exact: true }))
    .toBeInTheDocument();

  await vi.waitFor(() => {
    const list = document.querySelector<HTMLElement>("[data-thread-details-resource-list]");
    const viewport = list?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!list || !viewport) throw new Error("Expected the resource list and its viewport");
    expect(list.clientWidth).toBeLessThanOrEqual(280);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
    expect(list.clientHeight).toBeLessThanOrEqual(224);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  });
  expect(fixture.reads()).toBe(1);
  await act(() => vi.advanceTimersByTime(2_000));
  expect(fixture.reads()).toBe(2);

  const disclosure = page.getByRole("button", { name: "Remote status" });
  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect.element(page.getByText("AMD Radeon RX 7900 XTX")).not.toBeInTheDocument();
  fixture.flush();
  expect(fixture.activeReads()).toBe(0);
  await act(() => vi.advanceTimersByTime(10_000));
  expect(fixture.reads()).toBe(2);

  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect.element(page.getByText("AMD Radeon RX 7900 XTX")).toBeVisible();
  expect(fixture.reads()).toBe(3);
  await act(() => vi.advanceTimersByTime(2_000));
  expect(fixture.reads()).toBe(4);
  await act(() =>
    useRightPanelStore.getState().setThreadPanelOpen(fixture.threadRef, "popover", false),
  );
  fixture.flush();
  expect(fixture.activeReads()).toBe(0);
  await act(() => vi.advanceTimersByTime(10_000));
  expect(fixture.reads()).toBe(4);
  await expect.element(page.getByRole("region", { name: "Remote status" })).not.toBeInTheDocument();
  await screen.unmount();
});
