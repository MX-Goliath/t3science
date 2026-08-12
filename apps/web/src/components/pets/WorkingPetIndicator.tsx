import { PetSprite } from "./PetSprite";
import { useDesktopPets } from "./useDesktopPets";

export function WorkingPetIndicator({
  isRevertingCheckpoint,
}: {
  readonly isRevertingCheckpoint: boolean;
}) {
  const { state, selectedPet } = useDesktopPets();
  const workingPet = state?.supported === true && state.enabled ? selectedPet : null;

  if (workingPet) {
    return <PetSprite pet={workingPet} animation={isRevertingCheckpoint ? "review" : "running"} />;
  }

  return (
    <span className="inline-flex items-center gap-[3px]" data-working-indicator="dots">
      <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-status-pulse" />
      <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-status-pulse [animation-delay:200ms]" />
      <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-status-pulse [animation-delay:400ms]" />
    </span>
  );
}
