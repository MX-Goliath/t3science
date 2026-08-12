import type { DesktopPetMetadata, DesktopPetsState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPets = vi.hoisted(() => ({
  state: null as DesktopPetsState | null,
  loading: false,
  busy: false,
  error: null as string | null,
  setEnabled: vi.fn(),
  assignPet: vi.fn(),
  petForProvider: vi.fn(() => null),
  importArchive: vi.fn(),
  removePet: vi.fn(),
}));

vi.mock("../pets/useDesktopPets", () => ({
  useDesktopPets: () => mockPets,
}));

import { DesktopPetsSettings } from "./DesktopPetsSettings";

const codex: DesktopPetMetadata = {
  id: "openai-codex",
  displayName: "Codex",
  description: "A lively Codex companion",
  source: "bundled",
  protected: true,
  assetRevision: "codex-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/openai-codex/spritesheet.webp?v=codex",
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
    mockPets.loading = false;
    mockPets.busy = false;
    mockPets.error = null;
  });

  it("stays hidden outside a supported desktop bridge", () => {
    expect(renderToStaticMarkup(<DesktopPetsSettings />)).toBe("");
  });

  it("lists the installed library without a shared selection, and offers removal only for imported pets", () => {
    mockPets.state = {
      supported: true,
      enabled: true,
      assignments: [{ providerInstanceId: "codex", petId: codex.id }],
      pets: [codex, custom],
      errors: [],
    };

    const markup = renderToStaticMarkup(<DesktopPetsSettings />);

    expect(markup).toContain("Codex");
    expect(markup).toContain("Custom Pet");
    expect(markup).toContain('data-pet-size="card"');
    expect(markup).toContain("Import ZIP");
    // Choosing a companion is a per-provider setting: no selection state and
    // no shared preview live here.
    expect(markup).not.toContain("aria-pressed");
    expect(markup).not.toContain('data-pet-size="preview"');
    expect(markup.match(/Remove/g)).toHaveLength(1);
  });
});
