import "~/index.css";

import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { SystemResourceDisplaySettings } from "./SystemResourceDisplaySettings";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useUpdateEnvironmentSettings: () => mocks.save,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { settingsValueAtom: mocks.settings },
}));

it("responds before the remote save, combines queued edits, and rolls back a rejected edit", async () => {
  const settings = Atom.make(DEFAULT_SERVER_SETTINGS);
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  mocks.settings.mockReturnValue(settings);
  const writes: Array<{
    patch: ServerSettingsPatch;
    onSaved: () => void;
    onFailed: () => void;
  }> = [];
  mocks.save.mockImplementation((patch, callbacks) => writes.push({ patch, ...callbacks }));
  await using screen = await render(
    <RegistryContext value={registry}>
      <SystemResourceDisplaySettings environmentId={EnvironmentId.make("remote")} connected />
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
