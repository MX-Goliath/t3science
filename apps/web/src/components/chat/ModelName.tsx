import { useRef } from "react";
import { cn } from "~/lib/utils";
import styles from "./ModelName.module.css";

export function ModelName(props: { children: string; className?: string }) {
  const animationRef = useRef<Animation | null>(null);
  const stop = () => {
    animationRef.current?.cancel();
    animationRef.current = null;
  };

  return (
    <span
      className={cn(styles.viewport, props.className)}
      data-model-name
      onPointerEnter={(event) => {
        stop();
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const viewport = event.currentTarget;
        const text = viewport.firstElementChild;
        if (!text) return;
        const overflow = text.scrollWidth - viewport.clientWidth;
        if (overflow <= 0) return;
        animationRef.current = text.animate(
          [{ transform: "translateX(0)" }, { transform: `translateX(-${overflow}px)` }],
          { delay: 400, duration: Math.max(600, (overflow / 40) * 1000), fill: "forwards" },
        );
      }}
      onPointerLeave={stop}
      ref={() => stop}
    >
      <span className={styles.text}>{props.children}</span>
    </span>
  );
}
