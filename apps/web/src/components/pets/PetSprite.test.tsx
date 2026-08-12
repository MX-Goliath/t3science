import type { DesktopPetMetadata } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PetSprite } from "./PetSprite";
import { PET_ANIMATION_OPTIONS } from "./petAnimations";

const pet: DesktopPetMetadata = {
  id: "codex-buddy",
  displayName: "Codex Buddy",
  description: "A test pet",
  source: "bundled",
  protected: true,
  assetRevision: "asset-revision",
  spritesheetUrl: "t3science://app/__desktop-pets/codex-buddy/spritesheet.webp?v=asset-revision",
};

describe("PetSprite", () => {
  it("supports all nine OpenPets animations without per-frame React state", () => {
    expect(PET_ANIMATION_OPTIONS).toHaveLength(9);
    for (const option of PET_ANIMATION_OPTIONS) {
      const markup = renderToStaticMarkup(<PetSprite pet={pet} animation={option.id} />);
      expect(markup).toContain(`data-pet-animation="${option.id}"`);
      expect(markup).toContain('data-pet-animate="true"');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain("spritesheet.webp");
    }
  });

  it("uses the fixed preview frame size", () => {
    const markup = renderToStaticMarkup(<PetSprite pet={pet} animation="review" size="preview" />);
    expect(markup).toContain('data-pet-size="preview"');
    expect(markup).toContain("asset-revision");
  });

  it("positions the working and review rows inside the 8-by-9 sheet", () => {
    const running = renderToStaticMarkup(<PetSprite pet={pet} animation="running" />);
    const review = renderToStaticMarkup(<PetSprite pet={pet} animation="review" />);

    expect(running).toContain("--pet-y-position:87.5%");
    expect(running).toContain("--pet-x-end:85.71428571428571%");
    expect(review).toContain("--pet-y-position:100%");
  });

  it("can render a static card thumbnail", () => {
    const markup = renderToStaticMarkup(
      <PetSprite pet={pet} animation="idle" size="card" animate={false} />,
    );

    expect(markup).toContain('data-pet-size="card"');
    expect(markup).toContain('data-pet-animate="false"');
    expect(markup).toContain("--pet-y-position:0%");
  });

  it("can limit an animation to three iterations", () => {
    const markup = renderToStaticMarkup(<PetSprite pet={pet} animation="jumping" iterations={3} />);

    expect(markup).toContain("animation-iteration-count:3");
  });
});
