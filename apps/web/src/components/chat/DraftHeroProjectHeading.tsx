import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { observeResize } from "~/lib/observeResize";

export function DraftHeroProjectHeading({
  children,
  companion,
  projectName,
}: {
  children: ReactNode;
  companion?: ReactNode;
  projectName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const companionRef = useRef<HTMLSpanElement>(null);
  const inlineRef = useRef<HTMLSpanElement>(null);
  const [fitsInline, setFitsInline] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the heading against its container via ResizeObserver to choose inline or stacked layout
  useLayoutEffect(() => {
    const container = containerRef.current;
    const inline = inlineRef.current;
    const companion = companionRef.current;
    if (!container || !inline || !companion) return;

    // Measure the full inline heading independently of its current layout, so
    // moving the name below it cannot make the fit check oscillate.
    const update = () => {
      const companionWidth = companion.getBoundingClientRect().width;
      const gap = companionWidth > 0 ? Number.parseFloat(getComputedStyle(container).columnGap) : 0;
      setFitsInline(
        inline.getBoundingClientRect().width + companionWidth + gap <=
          container.getBoundingClientRect().width,
      );
    };
    update();
    return observeResize([container, inline, companion], update);
  }, []);

  return (
    <div
      ref={containerRef}
      className="group/draft-hero relative flex w-full items-center justify-center gap-3"
      data-inline={fitsInline}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <span
          ref={inlineRef}
          className="flex w-max items-baseline gap-2 whitespace-nowrap font-normal text-3xl tracking-tight"
        >
          <span>What should we build in</span>
          <span>
            <span className="font-medium">{projectName}</span>?
          </span>
        </span>
      </span>
      <span ref={companionRef} className="flex shrink-0 -translate-y-1 empty:hidden">
        {companion}
      </span>
      <h1 className="flex min-w-0 flex-col items-center justify-center gap-2 text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl lg:group-data-[inline=true]/draft-hero:flex-row lg:group-data-[inline=true]/draft-hero:items-baseline">
        <span className="max-w-full lg:group-data-[inline=true]/draft-hero:shrink-0">
          What should we build
          <span className="lg:group-data-[inline=true]/draft-hero:hidden">?</span>
          <span className="hidden lg:group-data-[inline=true]/draft-hero:inline"> in</span>
        </span>
        <span className="flex min-w-0 max-w-full items-baseline justify-center text-base tracking-normal lg:group-data-[inline=true]/draft-hero:text-3xl lg:group-data-[inline=true]/draft-hero:tracking-tight">
          <span className="min-w-0">{children}</span>
          <span className="hidden shrink-0 lg:group-data-[inline=true]/draft-hero:inline">?</span>
        </span>
      </h1>
    </div>
  );
}
