import {
  DesktopSystemIntegrationSettingsSchema,
  DesktopSystemIntegrationStateSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopSystemIntegration from "../../app/DesktopSystemIntegration.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getSystemIntegrationState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_SYSTEM_INTEGRATION_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopSystemIntegrationStateSchema,
  handler: Effect.fn("desktop.ipc.systemIntegration.getState")(function* () {
    const integration = yield* DesktopSystemIntegration.DesktopSystemIntegration;
    return yield* integration.getState;
  }),
});

export const setSystemIntegrationSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_SYSTEM_INTEGRATION_SETTINGS_CHANNEL,
  payload: DesktopSystemIntegrationSettingsSchema,
  result: DesktopSystemIntegrationStateSchema,
  handler: Effect.fn("desktop.ipc.systemIntegration.setSettings")(function* (settings) {
    const integration = yield* DesktopSystemIntegration.DesktopSystemIntegration;
    return yield* integration.setSettings(settings);
  }),
});
