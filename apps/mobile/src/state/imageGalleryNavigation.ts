import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "./atom-registry";

export const imageGalleryResetRevision = Atom.make(0).pipe(Atom.keepAlive);
export function resetMobileImages() {
  appAtomRegistry.set(
    imageGalleryResetRevision,
    appAtomRegistry.get(imageGalleryResetRevision) + 1,
  );
}
