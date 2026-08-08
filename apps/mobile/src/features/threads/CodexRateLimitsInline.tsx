import type { ServerProviderRateLimitWindow, ServerProviderRateLimits } from "@t3tools/contracts";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";
import { codexRateLimitTrackColor } from "./codexRateLimits";

function RateLimitRing(props: { label: string; window: ServerProviderRateLimitWindow }) {
  const remainingPercent = Math.max(0, Math.min(100, props.window.remainingPercent));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;

  return (
    <View
      className="flex-row items-center gap-1"
      accessible
      accessibilityLabel={`${props.label} Codex limit: ${remainingPercent}% remaining`}
    >
      <Svg width={18} height={18} viewBox="0 0 18 18" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={9}
          cy={9}
          r={radius}
          fill="none"
          stroke="rgba(142, 142, 147, 0.24)"
          strokeWidth={2.5}
        />
        <Circle
          cx={9}
          cy={9}
          r={radius}
          fill="none"
          stroke={codexRateLimitTrackColor(remainingPercent)}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - remainingPercent / 100)}
        />
      </Svg>
      <Text className="text-2xs text-foreground-muted">{props.label}</Text>
      <Text className="text-2xs font-t3-bold text-foreground">{remainingPercent}%</Text>
    </View>
  );
}

export function CodexRateLimitsInline(props: { rateLimits: ServerProviderRateLimits }) {
  if (!props.rateLimits.fiveHour && !props.rateLimits.weekly) return null;

  return (
    <View className="h-11 flex-row items-center gap-2 rounded-full bg-subtle px-2.5">
      {props.rateLimits.fiveHour ? (
        <RateLimitRing label="5h" window={props.rateLimits.fiveHour} />
      ) : null}
      {props.rateLimits.weekly ? (
        <RateLimitRing label="Week" window={props.rateLimits.weekly} />
      ) : null}
    </View>
  );
}
