import type { ModelSelection, ScopedProjectRef } from "@t3tools/contracts";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type DraftId,
} from "~/composerDraftStore";
import { newDraftId, newThreadId } from "~/lib/utils";
const IMAGE_DRAFT_PREFIX = "image-library:";

export function isImageGalleryDraft(session: { logicalProjectKey: string }) {
  return session.logicalProjectKey.startsWith(IMAGE_DRAFT_PREFIX);
}

export function openImageGalleryDraft(
  project: ScopedProjectRef,
  imageId: string | null,
  model: ModelSelection | null,
) {
  const store = useComposerDraftStore.getState();
  const key = `${IMAGE_DRAFT_PREFIX}${project.environmentId}:${imageId ?? "new"}`;
  const existing = store.getDraftSessionByLogicalProjectKey(key);
  if (existing && !existing.promotedTo) return existing.draftId;
  const id = newDraftId();
  store.setLogicalProjectDraftThreadId(key, project, id, {
    threadId: newThreadId(),
    envMode: "local",
    branch: null,
    worktreePath: null,
    startFromOrigin: false,
  });
  store.applyStickyState(id);
  if (model) store.setModelSelection(id, model);
  return id;
}

export function discardUneditedImageDraft(id: DraftId, sourceName: string) {
  const store = useComposerDraftStore.getState();
  const session = store.getDraftSession(id);
  const draft = store.getComposerDraft(id);
  if (
    !session ||
    session.promotedTo ||
    !draft ||
    (draft.images.length > 0 &&
      (draft.images.length !== 1 || draft.images[0]?.name !== sourceName)) ||
    composerDraftHasUserContent({ ...draft, images: [] })
  )
    return;
  if (draft.images[0]) store.removeImage(id, draft.images[0].id);
  store.clearDraftThread(id);
}
