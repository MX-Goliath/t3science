import { m as translateScienceCopy } from "../../i18n/messages";
import { T, msg } from "gt-react-native";
import {
  openAndroidLiveUpdateSettings,
  supportsAndroidLiveUpdateSettings,
} from "../agent-awareness/androidNotifications";
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
    <SettingsSection title={translateScienceCopy(msg("Direct notifications"))}>
      <SettingsSwitchRow
        icon="bell.badge"
        label={translateScienceCopy(msg("Background notifications"))}
        subtitle={translateScienceCopy(
          msg("Connect directly to paired servers. No T3 Connect or Firebase required."),
        )}
        value={enabled}
        disabled={!supportsDirectNotifications || requesting || !AsyncResult.isSuccess(preferences)}
        onValueChange={(value) => void toggle(value)}
      />
      {!supportsDirectNotifications ? (
        <Text className="px-4 text-sm text-foreground-muted">
          <T>Install a newer Android build to enable direct notifications.</T>
        </Text>
      ) : null}
      {enabled ? (
        <>
          <Text className="px-4 text-sm text-foreground-muted">
            {status?.enabled
              ? translateScienceCopy(
                  msg("{connected} of {total} environments connected", {
                    connected: status.connected,
                    total: status.total,
                  }),
                )
              : translateScienceCopy(msg("Starting background connection…"))}
            {"\n"}
            <T>
              Uses enabled direct connections, including LAN, Tailscale and bearer-authenticated
              tunnels. A persistent notification keeps the service visible.
            </T>
            {"\n"}
            <T>
              For delivery while the phone sleeps, allow unrestricted battery use. Android or your
              phone manufacturer may still delay delivery. Force-stopping the app stops
              notifications until you reopen it.
            </T>
          </Text>
          {error ? <Text className="px-4 text-sm text-foreground-muted">{error}</Text> : null}
          {status?.errors?.map((entry) => (
            <Text key={entry.environmentId} className="px-4 text-sm text-foreground-muted">
              {entry.label}: {entry.message}
            </Text>
          ))}
          <SettingsRow
            icon="bolt.circle"
            label={translateScienceCopy(msg("Battery settings"))}
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
            label={translateScienceCopy(msg("Android notification settings"))}
            onPress={() => void Linking.openSettings()}
          />
        </>
      ) : null}
      {supportsAndroidLiveUpdateSettings() ? (
        <SettingsRow
          icon="bolt.circle"
          label={translateScienceCopy(msg("Live Update Settings"))}
          onPress={() => {
            void openAndroidLiveUpdateSettings().catch(() => {
              Dialog.alert(
                translateScienceCopy(msg("Couldn't open Settings")),
                translateScienceCopy(
                  msg(
                    "Open Android Settings, select T3 Science, then enable Live Updates in Notifications.",
                  ),
                ),
              );
            });
          }}
        />
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
        translateScienceCopy(msg("Notification permission needed")),
        translateScienceCopy(msg("Allow notifications for T3 Science in Android Settings.")),
        [
          { text: translateScienceCopy(msg("Cancel")), style: "cancel" },
          {
            text: translateScienceCopy(msg("Open Settings")),
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
      return false;
    }
    return true;
  } catch {
    Dialog.alert(
      translateScienceCopy(msg("Notifications unavailable")),
      translateScienceCopy(
        msg("Could not enable notifications. Check this app's Android notification settings."),
      ),
    );
  }
  return false;
}
