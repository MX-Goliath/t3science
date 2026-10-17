import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DesktopPetsState } from "@t3tools/contracts";
import { useDesktopPets } from "./useDesktopPets";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

it("hydrates once for multiple consumers and shares enabled-state changes", async () => {
  const initial: DesktopPetsState = {
    supported: true,
    enabled: true,
    pets: [],
    assignments: [],
    errors: [],
  };
  let resolveState!: (state: DesktopPetsState) => void;
  const getDesktopPetsState = vi.fn(
    () =>
      new Promise<DesktopPetsState>((resolve) => {
        resolveState = resolve;
      }),
  );
  const setDesktopPetsEnabled = vi.fn(async (enabled: boolean) => ({ ...initial, enabled }));
  vi.stubGlobal("desktopBridge", { getDesktopPetsState, setDesktopPetsEnabled });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Consumer() {
    const pets = useDesktopPets();
    return (
      <button onClick={() => void pets.setEnabled(false)}>
        {pets.loading ? "Loading" : pets.state?.enabled ? "Enabled" : "Disabled"}
      </button>
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <Consumer />
        <Consumer />
      </>,
    ),
  );
  expect(getDesktopPetsState).toHaveBeenCalledOnce();
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Loading",
    "Loading",
  ]);
  await act(async () => resolveState(initial));
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Enabled",
    "Enabled",
  ]);
  await act(async () => host!.querySelector("button")!.click());
  expect(setDesktopPetsEnabled).toHaveBeenCalledExactlyOnceWith(false);
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Disabled",
    "Disabled",
  ]);
});
