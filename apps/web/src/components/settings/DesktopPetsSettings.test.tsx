import type { DesktopPetMetadata, DesktopPetsState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPets = vi.hoisted(() => ({
  state: null as DesktopPetsState | null,
  selectedPet: null as DesktopPetMetadata | null,
  loading: false,
  busy: false,
  error: null as string | null,
  setEnabled: vi.fn(),
  selectPet: vi.fn(),
  importArchive: vi.fn(),
  removePet: vi.fn(),
}));

vi.mock("../pets/useDesktopPets", () => ({
  useDesktopPets: () => mockPets,
}));

import { DesktopPetsSettings } from "./DesktopPetsSettings";

const codex: DesktopPetMetadata = {
  id: "codex-buddy",
  displayName: "Codex Buddy",
  description: "A lively Codex companion",
  source: "bundled",
  protected: true,
  assetRevision: "codex-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/codex-buddy/spritesheet.webp?v=codex",
};

const custom: DesktopPetMetadata = {
  id: "custom-pet",
  displayName: "Custom Pet",
  description: "A user-imported companion",
  source: "user-import",
  protected: false,
  assetRevision: "custom-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/custom-pet/spritesheet.webp?v=custom",
};

describe("DesktopPetsSettings", () => {
  beforeEach(() => {
    mockPets.state = null;
    mockPets.selectedPet = null;
    mockPets.loading = false;
    mockPets.busy = false;
    mockPets.error = null;
  });

  it("stays hidden outside a supported desktop bridge", () => {
    expect(renderToStaticMarkup(<DesktopPetsSettings />)).toBe("");
  });

  it("renders selectable pet cards, a preview, and removal only for imported pets", () => {
    mockPets.state = {
      supported: true,
      enabled: true,
      selectedPetId: codex.id,
      pets: [codex, custom],
      errors: [],
    };
    mockPets.selectedPet = codex;

    const markup = renderToStaticMarkup(<DesktopPetsSettings />);

    expect(markup).toContain("Codex Buddy");
    expect(markup).toContain("Custom Pet");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('data-pet-size="card"');
    expect(markup).toContain('data-pet-size="preview"');
    expect(markup).toContain("Import ZIP");
    expect(markup.match(/Remove/g)).toHaveLength(1);
  });
});
