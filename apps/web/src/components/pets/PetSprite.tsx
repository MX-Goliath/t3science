import type { CSSProperties } from "react";
import type { DesktopPetAnimationState, DesktopPetMetadata } from "@t3tools/contracts";

import { PET_ANIMATIONS } from "./petAnimations";
import "./petSprite.css";

type PetSpriteProps = {
  readonly pet: DesktopPetMetadata;
  readonly animation: DesktopPetAnimationState;
  readonly size?: "working" | "hero" | "card" | "preview";
  readonly animate?: boolean;
  readonly iterations?: number;
  readonly className?: string;
};

export function PetSprite({
  pet,
  animation,
  size = "working",
  animate = true,
  iterations,
  className,
}: PetSpriteProps) {
  const definition = PET_ANIMATIONS[animation];
  // CSS background-position percentages are relative to the remaining space
  // after the 8x9 sheet is scaled. Positive values move the oversized image
  // left/up. With steps(N), the endpoint must advance N columns so the last
  // visible step lands on frame N - 1.
  const xEnd = `${(definition.frames / 7) * 100}%`;
  const yPosition = `${(definition.row / 8) * 100}%`;
  const style = {
    backgroundImage: `url("${pet.spritesheetUrl}")`,
    ["--pet-frames"]: definition.frames,
    ["--pet-duration"]: `${definition.durationMs}ms`,
    ["--pet-x-end"]: xEnd,
    ["--pet-y-position"]: yPosition,
    animationIterationCount: iterations,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={className ? `desktop-pet-sprite ${className}` : "desktop-pet-sprite"}
      data-pet-animation={animation}
      data-pet-animate={animate ? "true" : "false"}
      data-pet-size={size}
      style={style}
    />
  );
}
