import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";

function UsageWindow(props: { window: ServerProviderUsageWindow; providerLabel: string }) {
  const remaining = remainingPercent(props.window);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const color = remaining > 50 ? "#34c759" : remaining >= 20 ? "#ff9f0a" : "#ff453a";

  return (
    <View
      className="flex-row items-center gap-1"
      accessible
      accessibilityLabel={`${props.window.label} ${props.providerLabel} limit: ${remaining}% remaining`}
    >
      <Svg width={18} height={18} viewBox="0 0 18 18" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={9}
          cy={9}
          r={radius}
          fill="none"
          stroke="rgba(142,142,147,0.24)"
          strokeWidth={2.5}
        />
        <Circle
          cx={9}
          cy={9}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - remaining / 100)}
        />
      </Svg>
      <Text className="text-2xs text-foreground-muted">{props.window.label}</Text>
      <Text className="text-2xs font-t3-bold text-foreground">{remaining}%</Text>
    </View>
  );
}

export function ProviderUsageLimitsInline(props: {
  limits: ServerProviderUsageLimits;
  providerLabel: string;
}) {
  if (props.limits.unavailable || props.limits.windows.length === 0) return null;
  return (
    <View className="h-11 flex-row items-center gap-2 rounded-full bg-subtle px-2.5">
      {props.limits.windows.slice(0, 2).map((window) => (
        <UsageWindow key={window.id} window={window} providerLabel={props.providerLabel} />
      ))}
    </View>
  );
}
