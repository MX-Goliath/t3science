import { useRef, type CSSProperties, type ReactNode } from "react";

export function ImageGalleryContent({ children }: { children: ReactNode }) {
  const touchY = useRef<number | null>(null);
  const restComposer = (target: EventTarget | null) => {
    if (!(target instanceof Element) || !target.closest("[data-image-gallery-scroll]")) return;
    if (target.closest("[data-image-gallery-zoom]")) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest("[data-chat-composer-form]")) return;
    if (active.closest("[data-chat-column]") !== target.closest("[data-chat-column]")) return;
    active.blur();
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={
        {
          "--image-gallery-composer-space":
            "calc(var(--chat-composer-inset, 0px) + var(--spacing) * 6)",
        } as CSSProperties
      }
      onWheelCapture={(event) => {
        if (!event.ctrlKey && event.deltaY < 0) restComposer(event.target);
      }}
      onTouchStartCapture={(event) => {
        touchY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMoveCapture={(event) => {
        const nextY = event.touches[0]?.clientY ?? null;
        if (nextY !== null && touchY.current !== null && nextY > touchY.current)
          restComposer(event.target);
        touchY.current = nextY;
      }}
      onTouchEndCapture={() => {
        touchY.current = null;
      }}
    >
      {children}
    </div>
  );
}
