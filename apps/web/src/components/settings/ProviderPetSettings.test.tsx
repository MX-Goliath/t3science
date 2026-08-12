import type { DesktopPetMetadata, DesktopPetsState, ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPets = vi.hoisted(() => ({
  state: null as DesktopPetsState | null,
  loading: false,
  busy: false,
  error: null as string | null,
  setEnabled: vi.fn(),
  assignPet: vi.fn(),
  importArchive: vi.fn(),
  removePet: vi.fn(),
  petForProvider: (providerInstanceId: string | null | undefined) => {
    const state = mockPets.state;
    const petId = state?.assignments.find(
      (assignment) => assignment.providerInstanceId === providerInstanceId,
    )?.petId;
    return state?.pets.find((pet) => pet.id === petId) ?? null;
  },
}));

vi.mock("../pets/useDesktopPets", () => ({
  useDesktopPets: () => mockPets,
}));

import { ProviderPetSettings } from "./ProviderPetSettings";

const codex: DesktopPetMetadata = {
  id: "openai-codex",
  displayName: "Codex",
  description: "A lively Codex companion",
  source: "bundled",
  protected: true,
  assetRevision: "codex-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/openai-codex/spritesheet.webp?v=codex",
};

const claude: DesktopPetMetadata = {
  id: "claude",
  displayName: "Claude",
  description: "A calm Claude companion",
  source: "bundled",
  protected: true,
  assetRevision: "claude-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/claude/spritesheet.webp?v=claude",
};

const instanceId = "codex_personal" as ProviderInstanceId;

describe("ProviderPetSettings", () => {
  beforeEach(() => {
    mockPets.state = null;
    mockPets.busy = false;
    mockPets.error = null;
    mockPets.assignPet.mockReset();
  });

  it("stays hidden outside a supported desktop bridge", () => {
    expect(
      renderToStaticMarkup(<ProviderPetSettings instanceId={instanceId} displayName="Codex" />),
    ).toBe("");
  });

  it("previews the pet assigned to this instance and offers every installed pet plus none", () => {
    mockPets.state = {
      supported: true,
      enabled: true,
      assignments: [{ providerInstanceId: String(instanceId), petId: claude.id }],
      pets: [codex, claude],
      errors: [],
    };

    const markup = renderToStaticMarkup(
      <ProviderPetSettings instanceId={instanceId} displayName="Codex Personal" />,
    );

    expect(markup).toContain("Companion pet");
    expect(markup).toContain("No pet");
    expect(markup).toContain("Codex");
    expect(markup).toContain("Claude");
    // The assigned pet — not the driver's namesake — drives the preview.
    expect(markup).toContain('data-pet-size="preview"');
    expect(markup).toContain(claude.spritesheetUrl);
    expect(markup).toContain('data-pet-animation="running"');
  });

  it("drops the preview when the instance has no pet", () => {
    mockPets.state = {
      supported: true,
      enabled: true,
      assignments: [],
      pets: [codex],
      errors: [],
    };

    const markup = renderToStaticMarkup(
      <ProviderPetSettings instanceId={instanceId} displayName="Codex Personal" />,
    );

    expect(markup).not.toContain('data-pet-size="preview"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
