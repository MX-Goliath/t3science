import type { DesktopPetAnimationState, ProviderInstanceId } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { PetSprite } from "../pets/PetSprite";
import { PET_ANIMATION_OPTIONS } from "../pets/petAnimations";
import { useDesktopPets } from "../pets/useDesktopPets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

/**
 * Per-provider companion picker rendered inside a provider instance card.
 * Pets are a desktop-only feature installed on this device, so the whole
 * section disappears outside the desktop app; the assignment itself is keyed
 * by provider instance id and lives in the desktop's local pet state, not in
 * the environment's provider settings.
 */
export function ProviderPetSettings({
  instanceId,
  displayName,
}: {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
}) {
  const pets = useDesktopPets();
  const [previewAnimation, setPreviewAnimation] = useState<DesktopPetAnimationState>("running");
  const state = pets.state;
  if (!state?.supported) return null;

  const assignedPet = pets.petForProvider(instanceId);
  const assign = (petId: string | null) => {
    void pets.assignPet(String(instanceId), petId);
  };

  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <span className="text-xs font-medium text-foreground">Companion pet</span>
        <span className="text-xs text-muted-foreground">
          Shown in the Working row while {displayName} runs a turn. This setting only affects the
          Desktop app on this device.
        </span>
      </div>

      {!state.enabled ? (
        <p className="text-xs text-muted-foreground">
          Desktop pets are turned off in General settings, so nothing is shown while this provider
          works.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <PetChoiceTile
          selected={assignedPet === null}
          label="No pet"
          disabled={pets.busy}
          onSelect={() => assign(null)}
        >
          <span className="text-[10px] text-muted-foreground">None</span>
        </PetChoiceTile>
        {state.pets.map((pet) => (
          <PetChoiceTile
            key={pet.id}
            selected={assignedPet?.id === pet.id}
            label={pet.displayName}
            disabled={pets.busy}
            onSelect={() => assign(pet.id)}
          >
            <PetSprite pet={pet} animation="idle" size="card" animate={false} />
          </PetChoiceTile>
        ))}
      </div>

      {state.pets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pet is installed. Import an OpenPets ZIP from General settings first.
        </p>
      ) : null}

      {assignedPet ? (
        <div className="grid gap-2 rounded-lg border border-border/60 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">Animation preview</span>
            <Select
              value={previewAnimation}
              onValueChange={(value) => {
                if (value) setPreviewAnimation(value as DesktopPetAnimationState);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-36"
                aria-label={`Preview animation for ${displayName}`}
              >
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
          </div>
          <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-md bg-[radial-gradient(circle_at_center,var(--color-muted)_0%,transparent_68%)]">
            <PetSprite pet={assignedPet} animation={previewAnimation} size="preview" />
          </div>
        </div>
      ) : null}

      {pets.error ? <p className="text-xs text-destructive">{pets.error}</p> : null}
    </div>
  );
}

function PetChoiceTile({
  selected,
  label,
  disabled,
  onSelect,
  children,
}: {
  readonly selected: boolean;
  readonly label: string;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative flex w-24 flex-col items-center gap-1 rounded-lg border p-2 text-center outline-none transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected
          ? "border-primary/45 bg-primary/5 dark:bg-primary/10"
          : "border-border/60 bg-background hover:border-border",
      )}
    >
      <span className="flex h-16 items-center justify-center">{children}</span>
      <span className="w-full truncate text-[11px] text-foreground">{label}</span>
      {selected ? (
        <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-2" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}
