import {
  DesktopPetAssignInputSchema,
  DesktopPetIdInputSchema,
  DesktopPetImportResultSchema,
  DesktopPetsStateSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopPets from "../../pets/DesktopPets.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const getDesktopPetsState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_DESKTOP_PETS_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopPetsStateSchema,
  handler: Effect.fn("desktop.ipc.pets.getState")(function* () {
    const pets = yield* DesktopPets.DesktopPets;
    return yield* pets.getState;
  }),
});

export const setDesktopPetsEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_DESKTOP_PETS_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopPetsStateSchema,
  handler: Effect.fn("desktop.ipc.pets.setEnabled")(function* (enabled) {
    const pets = yield* DesktopPets.DesktopPets;
    return yield* pets.setEnabled(enabled);
  }),
});

export const assignDesktopPet = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ASSIGN_DESKTOP_PET_CHANNEL,
  payload: DesktopPetAssignInputSchema,
  result: DesktopPetsStateSchema,
  handler: Effect.fn("desktop.ipc.pets.assign")(function* (input) {
    const pets = yield* DesktopPets.DesktopPets;
    return yield* pets.assign(input.providerInstanceId, input.petId);
  }),
});

export const importDesktopPetArchive = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.IMPORT_DESKTOP_PET_ARCHIVE_CHANNEL,
  payload: Schema.Void,
  result: DesktopPetImportResultSchema,
  handler: Effect.fn("desktop.ipc.pets.importArchive")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const window = yield* ElectronWindow.ElectronWindow;
    const pets = yield* DesktopPets.DesktopPets;
    const paths = yield* dialog.pickFiles({
      owner: yield* window.focusedMainOrFirst,
      defaultPath: Option.none(),
      filters: [{ name: "OpenPets archive", extensions: ["zip"] }],
    });
    const archivePath = paths[0];
    if (archivePath === undefined) return { kind: "cancelled" } as const;
    return { kind: "imported", state: yield* pets.importArchive(archivePath) } as const;
  }),
});

export const removeDesktopPet = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.REMOVE_DESKTOP_PET_CHANNEL,
  payload: DesktopPetIdInputSchema,
  result: DesktopPetsStateSchema,
  handler: Effect.fn("desktop.ipc.pets.remove")(function* (input) {
    const pets = yield* DesktopPets.DesktopPets;
    return yield* pets.remove(input.petId);
  }),
});
