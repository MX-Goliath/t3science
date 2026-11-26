import "~/index.css";

import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerSettingsPatch,
  type SystemResourcesSnapshot,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { SystemResourceDisplaySettings } from "./SystemResourceDisplaySettings";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  save: vi.fn(),
  systemResources: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useUpdateEnvironmentSettings: () => mocks.save,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { settingsValueAtom: mocks.settings, systemResources: mocks.systemResources },
}));

const environmentId = EnvironmentId.make("remote");

function setup(disks: SystemResourcesSnapshot["disks"] = []) {
  const settings = Atom.make(DEFAULT_SERVER_SETTINGS);
  const registry = AtomRegistry.make();
  mocks.settings.mockReset().mockReturnValue(settings);
  const snapshot: SystemResourcesSnapshot = {
    supported: true,
    sampledAt: 0,
    cpu: { utilization: null, coreCount: 4, frequencyMhz: null, temperatureCelsius: null },
    memory: { usedBytes: 0, totalBytes: 0 },
    disks,
    gpus: [],
  };
  mocks.systemResources.mockReset().mockReturnValue(Atom.make(AsyncResult.success(snapshot)));
  const writes: Array<{
    patch: ServerSettingsPatch;
    onSaved: () => void;
    onFailed: () => void;
  }> = [];
  mocks.save
    .mockReset()
    .mockImplementation((patch, callbacks) => writes.push({ patch, ...callbacks }));
  return { settings, registry, writes, [Symbol.dispose]: () => registry.dispose() };
}

it("responds before the remote save, combines queued edits, and rolls back a rejected edit", async () => {
  using fixture = setup();
  const { settings, registry, writes } = fixture;
  await using screen = await render(
    <RegistryContext value={registry}>
      <SystemResourceDisplaySettings environmentId={environmentId} connected />
    </RegistryContext>,
  );
  const cpu = screen.getByRole("switch", { name: "CPU usage" });
  const ram = screen.getByRole("switch", { name: "RAM usage" });
  const gpu = screen.getByRole("switch", { name: "GPU usage" });
  await cpu.click();
  await expect.element(cpu).not.toBeChecked();
  await ram.click();
  await gpu.click();
  await expect.element(ram).not.toBeChecked();
  await expect.element(gpu).not.toBeChecked();
  expect(writes).toHaveLength(1);

  await act(() => writes[0]!.onSaved());
  expect(writes).toHaveLength(2);
  expect(writes[1]!.patch.systemResourceDisplay).toMatchObject({
    cpu: false,
    memory: false,
    gpu: false,
  });
  await act(() => {
    registry.set(settings, {
      ...DEFAULT_SERVER_SETTINGS,
      systemResourceDisplay: writes[0]!.patch.systemResourceDisplay!,
    });
    writes[1]!.onSaved();
  });
  await expect.element(ram).not.toBeChecked();
  await expect.element(gpu).not.toBeChecked();
  await act(() =>
    registry.set(settings, {
      ...DEFAULT_SERVER_SETTINGS,
      systemResourceDisplay: writes[1]!.patch.systemResourceDisplay!,
    }),
  );

  await cpu.click();
  await expect.element(cpu).toBeChecked();
  await act(() => writes[2]!.onFailed());
  await expect.element(cpu).not.toBeChecked();
  await expect.element(ram).not.toBeChecked();
  await expect.element(gpu).not.toBeChecked();
});

it("loads individual disks when resource settings open and saves which ones are displayed", async () => {
  const externalPath = "/run/media/watcher/Kingston240Gb";
  using fixture = setup([
    { id: "/", mountPath: "/", label: "/dev/sda1", usedBytes: 30, totalBytes: 100 },
    {
      id: externalPath,
      mountPath: externalPath,
      label: "/dev/sdb1",
      usedBytes: 80,
      totalBytes: 100,
    },
  ]);
  await using screen = await render(
    <RegistryContext value={fixture.registry}>
      <SystemResourceDisplaySettings environmentId={environmentId} connected />
    </RegistryContext>,
  );
  expect(mocks.systemResources).toHaveBeenCalledWith({ environmentId, input: {} });
  const root = screen.getByRole("switch", { name: "/ · sda1", exact: true });
  const external = screen.getByRole("switch", { name: "Kingston240Gb · sdb1", exact: true });
  await expect.element(external).toBeChecked();
  await external.click();
  await expect.element(external).not.toBeChecked();
  await expect.element(root).toBeChecked();
  expect(fixture.writes[0]?.patch.systemResourceDisplay?.hiddenDiskIds).toEqual([externalPath]);
  await act(() => fixture.writes[0]!.onSaved());
  await external.click();
  await expect.element(external).toBeChecked();
  expect(fixture.writes[1]?.patch.systemResourceDisplay?.hiddenDiskIds).toEqual([]);
  await act(() => fixture.writes[1]!.onSaved());
});
