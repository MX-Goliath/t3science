import type { IconProps } from "@tabler/icons-react-native/types";
import { forwardRef } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export const SteamDeckIcon = forwardRef<Svg, IconProps>(function SteamDeckIcon(
  { size = 24, color = "currentColor", strokeWidth = 1.8, ...props },
  ref,
) {
  return (
    <Svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 32 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <Path d="M5 6h22c3 0 4 1.5 4 4v3c0 3.5-1.5 5-5 5H6c-3.5 0-5-1.5-5-5v-3c0-2.5 1-4 4-4Z" />
      <Rect x="8" y="8" width="16" height="8" rx=".5" strokeWidth="1.4" />
      <Circle cx="4.5" cy="9.5" r="1" fill={color} stroke="none" />
      <Circle cx="27.5" cy="9.5" r="1" fill={color} stroke="none" />
      <Path d="M3.5 12.5h2v2h-2zM26.5 12.5h2v2h-2z" strokeWidth="1" />
    </Svg>
  );
});
