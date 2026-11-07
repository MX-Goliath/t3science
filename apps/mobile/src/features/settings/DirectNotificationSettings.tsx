import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Notifications from "expo-notifications";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  directNotificationsErrorAtom,
  openDirectNotificationBatterySettings,
  readDirectNotificationStatus,
  supportsDirectNotifications,
} from "../agent-awareness/directNotifications";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsRow } from "./components/SettingsRow";

export function DirectNotificationSettings() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const error = useAtomValue(directNotificationsErrorAtom);
  const enabled =
    AsyncResult.isSuccess(preferences) && preferences.value.directNotificationsEnabled === true;
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof readDirectNotificationStatus>>>(null);
  const [requesting, setRequesting] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the native service while this settings screen is visible
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (AppState.currentState !== "active") return;
      void readDirectNotificationStatus()
        .then((next) => {
          if (!disposed) setStatus(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    const subscription = AppState.addEventListener("change", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  async function toggle(value: boolean) {
    if (!value) {
      savePreferences({ directNotificationsEnabled: false });
      return;
    }
    setRequesting(true);
    const permitted = await requestDirectNotificationPermission();
    setRequesting(false);
    if (permitted) savePreferences({ directNotificationsEnabled: true });
  }

  return (
    <SettingsSection title="Direct notifications">
      <SettingsSwitchRow
        icon="bell.badge"
        label="Background notifications"
        subtitle="Connect directly to paired servers. No T3 Connect or Firebase required."
        value={enabled}
        disabled={!supportsDirectNotifications || requesting || !AsyncResult.isSuccess(preferences)}
        onValueChange={(value) => void toggle(value)}
      />
      {!supportsDirectNotifications ? (
        <Text className="px-4 text-sm text-foreground-muted">
          Install a newer Android build to enable direct notifications.
        </Text>
      ) : null}
      {enabled ? (
        <>
          <Text className="px-4 text-sm text-foreground-muted">
            {status?.enabled
              ? `${status.connected} of ${status.total} environments connected`
              : "Starting background connection…"}
            {"\n"}Uses enabled direct connections, including LAN, Tailscale and bearer-authenticated
            tunnels. A persistent notification keeps the service visible.
            {"\n"}For delivery while the phone sleeps, allow unrestricted battery use. Android or
            your phone manufacturer may still delay delivery. Force-stopping the app stops
            notifications until you reopen it.
          </Text>
          {error ? <Text className="px-4 text-sm text-foreground-muted">{error}</Text> : null}
          {status?.errors?.map((entry) => (
            <Text key={entry.environmentId} className="px-4 text-sm text-foreground-muted">
              {entry.label}: {entry.message}
            </Text>
          ))}
          <SettingsRow
            icon="bolt.circle"
            label="Battery settings"
            onPress={() => {
              try {
                openDirectNotificationBatterySettings();
              } catch {
                void Linking.openSettings();
              }
            }}
          />
          <SettingsRow
            icon="bell.badge"
            label="Android notification settings"
            onPress={() => void Linking.openSettings()}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

async function requestDirectNotificationPermission() {
  try {
    await Notifications.setNotificationChannelAsync("direct-agent-alerts", {
      name: "Direct agent alerts",
      importance: Notifications.AndroidImportance.HIGH,
    });
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      Dialog.alert(
        "Notification permission needed",
        "Allow notifications for T3 Science in Android Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
      return false;
    }
    return true;
  } catch {
    Dialog.alert(
      "Notifications unavailable",
      "Could not enable notifications. Check this app's Android notification settings.",
    );
  }
  return false;
}
