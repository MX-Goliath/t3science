import type { EnvironmentId, ImageLibraryEntry } from "@t3tools/contracts";

export type GalleryImage = ImageLibraryEntry & { environmentId: EnvironmentId };
export type ImageSelection = { image: GalleryImage; siblings: ReadonlyArray<GalleryImage> };
