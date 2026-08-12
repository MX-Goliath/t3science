import { useState } from "react";

import { PetSprite } from "./PetSprite";
import { useDesktopPets } from "./useDesktopPets";

export function DraftHeroPet({
  providerInstanceId,
}: {
  readonly providerInstanceId: string | null;
}) {
  const { state, petForProvider } = useDesktopPets();
  const [isJumping, setIsJumping] = useState(false);
  const pet =
    state?.supported === true && state.enabled ? petForProvider(providerInstanceId) : null;

  if (!pet) return null;

  return (
    <span
      className="inline-flex"
      data-draft-hero-pet="true"
      onMouseEnter={() => setIsJumping(true)}
      onMouseLeave={() => setIsJumping(false)}
      onAnimationEnd={() => setIsJumping(false)}
    >
      <PetSprite
        key={isJumping ? "jumping" : "idle"}
        pet={pet}
        animation={isJumping ? "jumping" : "idle"}
        size="hero"
        {...(isJumping ? { iterations: 3 } : {})}
      />
    </span>
  );
}
