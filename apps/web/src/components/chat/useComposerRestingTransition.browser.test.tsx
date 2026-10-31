import { useRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { useComposerRestingTransition } from "./useComposerRestingTransition";

import { useComposerAnimationSettings } from "./useComposerAnimationSettings";

vi.mock("../../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ active: false, durationMs: 0 }),
}));

function Composer() {
  const [collapsed, setCollapsed] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(0);
  const controls = useRef<HTMLDivElement>(null);
  const animation = useComposerAnimationSettings(true);
  const ref = useComposerRestingTransition(
    collapsed,
    controls,
    setOverlayHeight,
    animation.active,
    animation.durationMs,
  );
  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed)}>Toggle</button>
      <output>{overlayHeight}</output>
      <div data-chat-composer-overlay="true">
        <div>
          <div ref={ref} data-testid="surface">
            <div data-chat-composer-surface="true">
              <div style={{ height: collapsed ? 48 : 120 }}>Prompt</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

it("keeps the height transition alive through parent layout updates in both directions", async () => {
  // This exercises DOM geometry and Web Animations without a route.
  await using screen = await render(<Composer />, { router: false });
  const surface = screen.getByTestId("surface").element();
  await expect.element(screen.getByRole("status")).toHaveTextContent("120");
  const animate = Element.prototype.animate;
  using spy = vi.spyOn(Element.prototype, "animate").mockImplementation(function (
    this: Element,
    ...args
  ) {
    const animation = animate.apply(this, args);
    animation.pause();
    return animation;
  });
  for (const [start, end] of [
    [120, 48],
    [48, 120],
  ]) {
    await screen.getByRole("button", { name: "Toggle" }).click();
    await vi.waitFor(() => expect(surface.getAnimations().length).toBe(1));
    const animation = surface.getAnimations()[0]!;
    await act(async () => {
      animation.currentTime = 100;
    });
    const height = surface.getBoundingClientRect().height;
    expect(height).toBeGreaterThan(Math.min(start!, end!));
    expect(height).toBeLessThan(Math.max(start!, end!));
    await act(async () => {
      animation.finish();
      await animation.finished;
    });
    await vi.waitFor(() => expect(surface.getBoundingClientRect().height).toBe(end));
  }
  expect(spy).toHaveBeenCalledTimes(2);
});
