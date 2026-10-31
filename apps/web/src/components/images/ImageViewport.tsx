import { useRef, useState, type PointerEvent } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";

export function ImageViewport({
  src,
  name,
  zoom,
  onZoomChange,
  label,
}: {
  src: string;
  name: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  label: string;
}) {
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const fit = Math.min(
    1,
    viewportSize.width / (naturalSize.width || 1),
    viewportSize.height / (naturalSize.height || 1),
  );
  const width = naturalSize.width * fit * zoom;
  const height = naturalSize.height * fit * zoom;
  const attachViewport = (viewport: HTMLDivElement) => {
    const measure = () => {
      const next = { width: viewport.clientWidth, height: viewport.clientHeight };
      setViewportSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    measure();
    return observeResize(viewport, measure);
  };
  const onWheel = useStableCallback((event: WheelEvent) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    onZoomChange(
      Math.max(1, Math.min(4, zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002))),
    );
  });
  const attachWheel = (element: HTMLDivElement) => {
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="relative min-h-0 flex-1 px-4 pt-3">
      <div
        ref={attachViewport}
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-4 top-3 bottom-(--image-gallery-composer-space)"
      />
      <div
        ref={attachWheel}
        data-image-gallery-scroll
        data-image-gallery-zoom
        role="region"
        aria-label={label}
        tabIndex={0}
        className={`size-full overflow-auto overscroll-contain ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0 || zoom <= 1 || drag.current)
            return;
          const viewport = event.currentTarget;
          const bounds = viewport.getBoundingClientRect();
          if (
            event.clientX - bounds.left >= viewport.clientWidth ||
            event.clientY - bounds.top >= viewport.clientHeight
          )
            return;
          event.preventDefault();
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          };
          viewport.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointerId !== event.pointerId) return;
          event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
          event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div
          className="box-content flex items-center justify-center pb-(--image-gallery-composer-space)"
          style={{
            width: Math.max(viewportSize.width, width),
            height: Math.max(viewportSize.height, height),
          }}
        >
          <img
            src={src}
            alt={name}
            draggable={false}
            className="max-w-none select-none object-contain"
            style={naturalSize.width ? { width, height } : { maxWidth: "100%", maxHeight: "100%" }}
            onLoad={(event) =>
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
