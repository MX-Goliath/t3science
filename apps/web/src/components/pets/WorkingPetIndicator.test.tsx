import type { DesktopPetMetadata, DesktopPetsState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPets = vi.hoisted(() => ({
  state: null as DesktopPetsState | null,
  petForProvider: (providerInstanceId: string | null | undefined) => {
    const state = mockPets.state;
    const petId = state?.assignments.find(
      (assignment) => assignment.providerInstanceId === providerInstanceId,
    )?.petId;
    return state?.pets.find((pet) => pet.id === petId) ?? null;
  },
}));

vi.mock("./useDesktopPets", () => ({
  useDesktopPets: () => mockPets,
}));

import { WorkingPetIndicator } from "./WorkingPetIndicator";

const pet: DesktopPetMetadata = {
  id: "openai-codex",
  displayName: "Codex",
  description: "A test pet",
  source: "bundled",
  protected: true,
  assetRevision: "revision",
  spritesheetUrl: "t3science://app/__desktop-pets/openai-codex/spritesheet.webp?v=revision",
};

const assignedState: DesktopPetsState = {
  supported: true,
  enabled: true,
  assignments: [{ providerInstanceId: "codex", petId: pet.id }],
  pets: [pet],
  errors: [],
};

describe("WorkingPetIndicator", () => {
  beforeEach(() => {
    mockPets.state = null;
  });

  it("keeps the dots outside desktop or while pets are disabled", () => {
    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="running" providerInstanceId="codex" />),
    ).toContain('data-working-indicator="dots"');

    mockPets.state = { ...assignedState, enabled: false };
    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="running" providerInstanceId="codex" />),
    ).toContain('data-working-indicator="dots"');
  });

  it("keeps the dots for a provider instance with no assigned pet", () => {
    mockPets.state = assignedState;

    expect(
      renderToStaticMarkup(
        <WorkingPetIndicator animation="running" providerInstanceId="claudeAgent" />,
      ),
    ).toContain('data-working-indicator="dots"');
    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="running" providerInstanceId={null} />),
    ).toContain('data-working-indicator="dots"');
  });

  it("renders the requested animation for the provider's pet", () => {
    mockPets.state = assignedState;

    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="running" providerInstanceId="codex" />),
    ).toContain('data-pet-animation="running"');
    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="waiting" providerInstanceId="codex" />),
    ).toContain('data-pet-animation="waiting"');
    expect(
      renderToStaticMarkup(<WorkingPetIndicator animation="review" providerInstanceId="codex" />),
    ).toContain('data-pet-animation="review"');
  });
});
