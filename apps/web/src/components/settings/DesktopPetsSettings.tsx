import { Trash2Icon, UploadIcon } from "lucide-react";

import { PetSprite } from "../pets/PetSprite";
import { useDesktopPets } from "../pets/useDesktopPets";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Manages the installed pet library only. Which pet appears while a turn
 * runs is decided per provider instance, in Provider settings — there is no
 * shared companion.
 */
export function DesktopPetsSettings() {
  const pets = useDesktopPets();
  const state = pets.state;
  if (!state?.supported) return null;

  return (
    <SettingsSection
      id={searchableSetting("desktop-pets").id}
      title="Desktop pets"
      headerAction={
        <Button
          size="sm"
          variant="outline"
          disabled={pets.busy}
          onClick={() => void pets.importArchive()}
        >
          <UploadIcon className="size-3.5" aria-hidden />
          Import ZIP
        </Button>
      }
    >
      <SettingsRow
        id={searchableSetting("desktop-pets-enabled").id}
        title="Show pets"
        description="Show each provider's OpenPets companion in the Working row. Assign a pet to a provider in Provider settings. This setting only affects the Desktop app."
        control={
          <Switch
            checked={state.enabled}
            disabled={pets.busy || pets.loading}
            onCheckedChange={(checked) => void pets.setEnabled(Boolean(checked))}
            aria-label="Show pets"
          />
        }
      />
      <SettingsRow
        title="Installed pets"
        description="Imported OpenPets archives available to every provider. Assign and preview them per provider in Provider settings."
      >
        {state.pets.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {state.pets.map((pet) => (
              <div
                key={pet.id}
                className="overflow-hidden rounded-xl border border-border/60 bg-background"
              >
                <div className="flex w-full items-center gap-3 p-3 text-left">
                  <span className="flex size-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/25">
                    <PetSprite pet={pet} animation="idle" size="card" animate={false} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium text-foreground">
                      {pet.displayName}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {pet.description}
                    </span>
                  </span>
                </div>
                {!pet.protected ? (
                  <div className="flex justify-end border-t border-border/50 px-2 py-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={pets.busy}
                      onClick={() => void pets.removePet(pet.id)}
                    >
                      <Trash2Icon className="size-3.5" aria-hidden />
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No valid pet is currently available.</p>
        )}
      </SettingsRow>
      {pets.busy || pets.error || state.errors.length > 0 ? (
        <div className="mx-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-xs sm:mx-4">
          {pets.busy ? <p className="text-muted-foreground">Updating desktop pets…</p> : null}
          {pets.error ? <p className="text-destructive">{pets.error}</p> : null}
          {state.errors.map((error) => (
            <p key={error} className="text-destructive">
              {error}
            </p>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}
