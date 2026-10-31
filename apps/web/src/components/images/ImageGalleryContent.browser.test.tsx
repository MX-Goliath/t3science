import { expect, it } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { ImageGalleryContent } from "./ImageGalleryContent";

it("rests the composer when browsing images without disturbing its draft or controls", async () => {
  await using screen = await render(
    <div data-chat-column>
      <ImageGalleryContent>
        <div data-image-gallery-scroll aria-label="Gallery">
          Images
        </div>
      </ImageGalleryContent>
      <form data-chat-composer-form>
        <input aria-label="Prompt" defaultValue="Keep this edit" />
      </form>
    </div>,
    // The scroll/focus boundary does not depend on routing.
    { router: false },
  );
  const prompt = screen.getByRole("textbox", { name: "Prompt" }).element() as HTMLInputElement;
  const gallery = screen.getByLabelText("Gallery").element();
  await act(async () => {
    prompt.focus();
    prompt.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -80 }));
  });
  await expect.element(prompt).toHaveFocus();
  await act(async () => {
    gallery.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -80, ctrlKey: true }));
  });
  await expect.element(prompt).toHaveFocus();
  for (const event of [
    new WheelEvent("wheel", { bubbles: true, deltaY: 80 }),
    new Event("scroll"),
  ]) {
    await act(async () => {
      gallery.dispatchEvent(event);
    });
    await expect.element(prompt).toHaveFocus();
  }
  await act(async () => {
    gallery.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -80 }));
  });
  await expect.element(prompt).not.toHaveFocus();
  await expect.element(prompt).toHaveValue("Keep this edit");
  const touch = (type: string, clientY: number) =>
    new TouchEvent(type, {
      bubbles: true,
      touches: [new Touch({ identifier: 1, target: gallery, clientY })],
    });
  await act(async () => {
    prompt.focus();
    gallery.dispatchEvent(touch("touchstart", 100));
    gallery.dispatchEvent(touch("touchmove", 80));
  });
  await expect.element(prompt).toHaveFocus();
  await act(async () => {
    gallery.dispatchEvent(touch("touchmove", 120));
  });
  await expect.element(prompt).not.toHaveFocus();
  await expect.element(prompt).toHaveValue("Keep this edit");
});
