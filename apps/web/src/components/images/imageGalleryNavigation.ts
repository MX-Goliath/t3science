import { create } from "zustand";
import type { ImageSelection } from "./imageGalleryTypes";

export const useImageGallerySelection = create<{
  selection: ImageSelection | null;
  select: (selection: ImageSelection | null) => void;
}>((set) => ({ selection: null, select: (selection) => set({ selection }) }));

export function resetImageGallery() {
  useImageGallerySelection.getState().select(null);
}
