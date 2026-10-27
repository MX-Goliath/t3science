import { expect, it, vi } from "vite-plus/test";
import type { DesktopPetsState } from "@t3tools/contracts";
import { act, render, stubGlobal } from "../../../test/render";
import { useDesktopPets } from "./useDesktopPets";

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
  using _bridge = stubGlobal("desktopBridge", { getDesktopPetsState, setDesktopPetsEnabled });
  function Consumer() {
    const pets = useDesktopPets();
    return (
      <button onClick={() => void pets.setEnabled(false)}>
        {pets.loading ? "Loading" : pets.state?.enabled ? "Enabled" : "Disabled"}
      </button>
    );
  }
  await using screen = await render(
    <>
      <Consumer />
      <Consumer />
    </>,
  );
  expect(getDesktopPetsState).toHaveBeenCalledOnce();
  await expect.element(screen.getByRole("button", { name: "Loading" }).first()).toBeVisible();
  await act(async () => resolveState(initial));
  await expect.element(screen.getByRole("button", { name: "Enabled" }).nth(1)).toBeVisible();
  await screen.getByRole("button", { name: "Enabled" }).first().click();
  expect(setDesktopPetsEnabled).toHaveBeenCalledExactlyOnceWith(false);
  await expect.element(screen.getByRole("button", { name: "Disabled" }).nth(1)).toBeVisible();
});
