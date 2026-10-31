import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { ImageViewport } from "./ImageViewport";

function Viewer() {
  const [zoom, setZoom] = useState(1);
  return (
    <>
      <output>{zoom}</output>
      <ImageViewport
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E"
        name="Photo"
        label="Photo viewer"
        zoom={zoom}
        onZoomChange={setZoom}
      />
    </>
  );
}

it("zooms with the wheel and consumes scrolling at both zoom limits", async () => {
  // The image viewport has no routing dependencies.
  await using screen = await render(<Viewer />, { router: false });
  const viewport = screen.getByRole("region").element();
  const wheel = async (deltaY: number) => {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    await act(async () => {
      viewport.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  };
  await wheel(-100);
  expect(Number(screen.getByRole("status").element().textContent)).toBeGreaterThan(1);
  await wheel(100);
  await expect.element(screen.getByRole("status")).toHaveTextContent("1");
  for (let index = 0; index < 20; index++) await wheel(-100);
  await expect.element(screen.getByRole("status")).toHaveTextContent("4");
  for (let index = 0; index < 20; index++) await wheel(100);
  await expect.element(screen.getByRole("status")).toHaveTextContent("1");
});
