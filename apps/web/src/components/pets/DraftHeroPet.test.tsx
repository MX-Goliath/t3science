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

import { DraftHeroPet } from "./DraftHeroPet";

const pet: DesktopPetMetadata = {
  id: "openai-codex",
  displayName: "Codex",
  description: "A test pet",
  source: "bundled",
  protected: true,
  assetRevision: "revision",
  spritesheetUrl: "t3science://app/__desktop-pets/openai-codex/spritesheet.webp?v=revision",
};

describe("DraftHeroPet", () => {
  beforeEach(() => {
    mockPets.state = {
      supported: true,
      enabled: true,
      assignments: [{ providerInstanceId: "codex", petId: pet.id }],
      pets: [pet],
      errors: [],
    };
  });

  it("renders the active provider's assigned pet in idle mode", () => {
    const markup = renderToStaticMarkup(<DraftHeroPet providerInstanceId="codex" />);

    expect(markup).toContain('data-draft-hero-pet="true"');
    expect(markup).toContain('data-pet-animation="idle"');
    expect(markup).toContain('data-pet-size="hero"');
  });

  it("renders nothing for a provider without a pet", () => {
    expect(renderToStaticMarkup(<DraftHeroPet providerInstanceId="cursor" />)).toBe("");
  });
});
