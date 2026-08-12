import type { DesktopPetMetadata, DesktopPetsState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPets = vi.hoisted(() => ({
  state: null as DesktopPetsState | null,
  selectedPet: null as DesktopPetMetadata | null,
}));

vi.mock("./useDesktopPets", () => ({
  useDesktopPets: () => mockPets,
}));

import { WorkingPetIndicator } from "./WorkingPetIndicator";

const pet: DesktopPetMetadata = {
  id: "codex-buddy",
  displayName: "Codex Buddy",
  description: "A test pet",
  source: "bundled",
  protected: true,
  assetRevision: "revision",
  spritesheetUrl: "t3science://app/__desktop-pets/codex-buddy/spritesheet.webp?v=revision",
};

describe("WorkingPetIndicator", () => {
  beforeEach(() => {
    mockPets.state = null;
    mockPets.selectedPet = null;
  });

  it("keeps the dots outside desktop or while pets are disabled", () => {
    expect(renderToStaticMarkup(<WorkingPetIndicator isRevertingCheckpoint={false} />)).toContain(
      'data-working-indicator="dots"',
    );

    mockPets.state = {
      supported: true,
      enabled: false,
      selectedPetId: pet.id,
      pets: [pet],
      errors: [],
    };
    mockPets.selectedPet = pet;
    expect(renderToStaticMarkup(<WorkingPetIndicator isRevertingCheckpoint={false} />)).toContain(
      'data-working-indicator="dots"',
    );
  });

  it("renders running and review animations for the selected desktop pet", () => {
    mockPets.state = {
      supported: true,
      enabled: true,
      selectedPetId: pet.id,
      pets: [pet],
      errors: [],
    };
    mockPets.selectedPet = pet;

    expect(renderToStaticMarkup(<WorkingPetIndicator isRevertingCheckpoint={false} />)).toContain(
      'data-pet-animation="running"',
    );
    expect(renderToStaticMarkup(<WorkingPetIndicator isRevertingCheckpoint />)).toContain(
      'data-pet-animation="review"',
    );
  });
});
