import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePanelAnimationSettings } from "../../panelAnimations";

export function useComposerAnimationSettings(collapseWhenUnfocused: boolean) {
  const panels = usePanelAnimationSettings();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The gallery's input morph remains animated when panel resizing is disabled.
  return collapseWhenUnfocused
    ? { active: !reducedMotion, durationMs: panels.durationMs || 240 }
    : panels;
}
