import type { DesktopPetAnimationState } from "@t3tools/contracts";
import { CheckIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { PetSprite } from "../pets/PetSprite";
import { PET_ANIMATION_OPTIONS } from "../pets/petAnimations";
import { useDesktopPets } from "../pets/useDesktopPets";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function DesktopPetsSettings() {
  const pets = useDesktopPets();
  const [previewAnimation, setPreviewAnimation] = useState<DesktopPetAnimationState>("running");
  const state = pets.state;
  if (!state?.supported) return null;

  const selectedPet = pets.selectedPet;
  return (
    <SettingsSection
      id={searchableSetting("desktop-pets").id}
      title="Desktop pet"
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
        title="Show pet"
        description="Show the selected OpenPets companion in the Working row. This setting only affects the Desktop app."
        control={
          <Switch
            checked={state.enabled}
            disabled={pets.busy || pets.loading}
            onCheckedChange={(checked) => void pets.setEnabled(Boolean(checked))}
            aria-label="Show pet"
          />
        }
      />
      <SettingsRow
        title="Choose a pet"
        description="The selected companion is used for every agent and provider."
      >
        {state.pets.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {state.pets.map((pet) => {
              const selected = state.selectedPetId === pet.id;
              return (
                <div
                  key={pet.id}
                  className={cn(
                    "overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow]",
                    selected
                      ? "border-primary/45 bg-primary/5 shadow-sm ring-1 ring-primary/20 dark:bg-primary/10"
                      : "border-border/60 bg-background hover:border-border",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    className="group flex w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    disabled={pets.busy}
                    onClick={() => void pets.selectPet(pet.id)}
                  >
                    <span className="flex size-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/25">
                      <PetSprite pet={pet} animation="idle" size="card" animate={false} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {pet.displayName}
                        </span>
                        {selected ? (
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <CheckIcon className="size-2.5" aria-hidden />
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {pet.description}
                      </span>
                    </span>
                  </button>
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
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No valid pet is currently available.</p>
        )}
      </SettingsRow>
      <SettingsRow
        title="Animation preview"
        description="Check every animation included in the selected OpenPets spritesheet."
        control={
          <Select
            value={previewAnimation}
            disabled={!selectedPet || pets.busy}
            onValueChange={(value) => {
              if (value) setPreviewAnimation(value as DesktopPetAnimationState);
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Preview animation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PET_ANIMATION_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        <div className="mt-3 flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-[radial-gradient(circle_at_center,var(--color-muted)_0%,transparent_68%)]">
          {selectedPet ? (
            <PetSprite pet={selectedPet} animation={previewAnimation} size="preview" />
          ) : (
            <span className="text-xs text-muted-foreground">
              Select or import a pet to preview it.
            </span>
          )}
        </div>
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
