import type { ComponentProps } from "react";
import type ChatView from "../ChatView";
import { Atom } from "effect/reactivity";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ImageGalleryComposer } from "./ImageGalleryComposer";

const fixture = vi.hoisted(() => ({
  environmentId: "image-test-environment",
  projectId: "image-test-project",
}));
vi.mock("~/hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    openScratchProject: async () => ({ id: fixture.projectId }),
  }),
}));
vi.mock(import("~/state/server"), () => {
  const providers = Atom.make([]);
  return { providersIgnoringCheckedAtAtom: () => providers };
});
vi.mock(import("~/assets/assetUrls"), () => ({
  useAssetUrlState: () => ({
    _tag: "Success",
    expiresAt: 0,
    url: "data:image/png;base64,aW1hZ2U=",
  }),
  useAssetUrlRefresh: () => async () => "data:image/png;base64,aW1hZ2U=",
}));
vi.mock(import("~/lib/imageCompression"), async (original) => ({
  ...(await original()),
  prepareImageForAttachment: async (file: File) => ({ ok: true, file, recompressed: false }),
  readFileAsDataUrl: async () => "data:image/png;base64,aW1hZ2U=",
}));
vi.mock(import("../ChatView"), () => ({
  default: ({ draftId }: ComponentProps<typeof ChatView>) => {
    const count = useComposerDraftStore((store) =>
      draftId ? (store.getComposerDraft(draftId)?.images.length ?? 0) : 0,
    );
    return <output aria-label="Attachment count">{count}</output>;
  },
}));

it("keeps the viewed source image out of composer attachments", async () => {
  const environmentId = EnvironmentId.make(fixture.environmentId);
  const fileName = "source.png";
  await using screen = await render(
    <ImageGalleryComposer
      environmentId={environmentId}
      image={{
        id: "source",
        path: "/codex/generated_images/thread/source.png",
        directory: "/codex/generated_images/thread",
        fileName,
        nativeThreadId: "thread",
        providerInstanceId: ProviderInstanceId.make("codex"),
        createdAt: 0,
        sizeBytes: 5,
        origin: null,
        environmentId,
      }}
      content={<div>Viewed image</div>}
      onRetry={() => {}}
    />,
  );
  await act(async () => {});
  await expect.element(screen.getByLabelText("Attachment count")).toHaveTextContent("0");
});
