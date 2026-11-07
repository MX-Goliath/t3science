import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";
import { CredentialStore } from "@t3tools/client-runtime/connection";
import { ORCHESTRATION_PROTOCOL_VERSION, ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { directNotificationRoutes } from "./directNotificationConnections";

interface DirectNotificationsNative {
  configureDirectNotifications(configuration: string | null): Promise<void>;
  getDirectNotificationStatus(): Promise<string>;
  openBatterySettings(): void;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<DirectNotificationsNative>("T3AgentNotifications")
    : null;

export const supportsDirectNotifications =
  typeof native?.configureDirectNotifications === "function";

export const directNotificationsErrorAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

const Status = Schema.fromJsonString(
  Schema.Struct({
    enabled: Schema.Boolean,
    connected: Schema.Number,
    total: Schema.Number,
    errors: Schema.optional(
      Schema.Array(
        Schema.Struct({
          environmentId: Schema.String,
          label: Schema.String,
          message: Schema.String,
        }),
      ),
    ),
  }),
);

const decodeStatus = Schema.decodeSync(Status);
const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export async function readDirectNotificationStatus() {
  if (!supportsDirectNotifications) return null;
  return decodeStatus(await native!.getDirectNotificationStatus());
}

export function openDirectNotificationBatterySettings() {
  native?.openBatterySettings();
}

const configurationAtom = connectionAtomRuntime
  .atom((get) => {
    const preferences = get(mobilePreferencesAtom);
    if (!AsyncResult.isSuccess(preferences)) return Effect.never;
    if (preferences.value.directNotificationsEnabled !== true) return Effect.succeed(null);
    const catalog = get(environmentCatalog.catalogValueAtom);
    if (!catalog.isReady) return Effect.never;
    const routes = directNotificationRoutes(catalog.entries.values());
    return Effect.gen(function* () {
      const credentials = yield* CredentialStore.ConnectionCredentialStore;
      const connections = [];
      for (const route of routes) {
        const saved = yield* credentials.get(route.connectionId);
        if (Option.isNone(saved) || saved.value.token.trim() === "") continue;
        const { connectionId: _connectionId, ...connection } = route;
        connections.push({
          ...connection,
          bearerToken: saved.value.token,
          protocol: String(ORCHESTRATION_PROTOCOL_VERSION),
          subscribeMethod: ORCHESTRATION_V2_WS_METHODS.subscribeShell,
        });
      }
      const scheme = Constants.expoConfig?.scheme;
      return yield* encodeConfiguration({
        scheme: (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3science",
        connections,
      });
    });
  })
  .pipe(Atom.keepAlive);

export function installDirectNotifications(): () => void {
  if (!supportsDirectNotifications) return () => undefined;
  let disposed = false;
  let applied: string | null | undefined;
  let queue = Promise.resolve();
  const update = () => {
    if (AppState.currentState !== "active") return;
    const configuration = appAtomRegistry.get(configurationAtom);
    if (!AsyncResult.isSuccess(configuration)) return;
    const value = configuration.value;
    if (value === applied) return;
    queue = queue.then(async () => {
      if (disposed || value === applied) return;
      try {
        await native!.configureDirectNotifications(value);
        applied = value;
        appAtomRegistry.set(directNotificationsErrorAtom, null);
      } catch {
        // Native connection errors can include credentials; show a fixed message.
        appAtomRegistry.set(
          directNotificationsErrorAtom,
          "Could not start background notifications. Check notification permission and try turning them off and on.",
        );
      }
    });
  };
  const unsubscribe = appAtomRegistry.subscribe(configurationAtom, update, { immediate: true });
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") applied = undefined;
    update();
  });
  return () => {
    disposed = true;
    unsubscribe();
    subscription.remove();
  };
}
