import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type EnvironmentId,
  type ImageLibraryEntry,
} from "@t3tools/contracts";
import { imageMimeType } from "@t3tools/shared/image";
import { File, Directory } from "expo-file-system";
import { refreshAssetUrl } from "../../state/assets";
import { downloadAttachmentForPreview } from "../../lib/attachmentDownload";
import { fitComposerImage, renderPhoto } from "../../lib/composerImageFit";
import { estimateBase64ByteSize } from "../../lib/base64";
import { uuidv4 } from "../../lib/uuid";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";

export function imageResource(image: ImageLibraryEntry) {
  return { _tag: "draft-workspace-file" as const, cwd: image.directory, path: image.fileName };
}

async function downloadGalleryImage(
  environmentId: EnvironmentId,
  image: ImageLibraryEntry,
  signal: AbortSignal,
) {
  const url = await refreshAssetUrl(environmentId, imageResource(image), signal);
  if (!url || signal.aborted) throw new Error("Image unavailable");
  return downloadAttachmentForPreview({
    url,
    attachment: {
      name: image.fileName,
      mimeType: imageMimeType({ name: image.fileName, mimeType: "" }) ?? "image/png",
    },
    signal,
  });
}

export async function prepareGalleryImage(
  environmentId: EnvironmentId,
  image: ImageLibraryEntry,
  signal: AbortSignal,
): Promise<DraftComposerImageAttachment | null> {
  const cached = await downloadGalleryImage(environmentId, image, signal);
  if (!cached) return null;
  try {
    const mimeType = imageMimeType({ name: image.fileName, mimeType: "" }) ?? "image/png";
    const original = await new File(cached.uri).base64();
    if (signal.aborted) return null;
    const fitted = await fitComposerImage({
      uri: cached.uri,
      mimeType,
      base64: original,
    });
    const rendered =
      fitted ??
      (estimateBase64ByteSize(original) > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
        ? await renderPhoto(cached.uri, "png")
        : null);
    if (signal.aborted) return null;
    const base64 = rendered?.base64 ?? original;
    const sizeBytes = estimateBase64ByteSize(base64);
    if (sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) throw new Error("Image too large");
    const outputMimeType = fitted
      ? mimeType === "image/png"
        ? "image/png"
        : "image/jpeg"
      : rendered
        ? "image/png"
        : mimeType;
    const dataUrl = `data:${outputMimeType};base64,${base64}`;
    return {
      id: uuidv4(),
      type: "image",
      name: image.fileName,
      mimeType: outputMimeType,
      sizeBytes,
      dataUrl,
      previewUri: dataUrl,
    };
  } finally {
    cached.dispose();
  }
}

export async function saveGalleryImage(
  environmentId: EnvironmentId,
  image: ImageLibraryEntry,
  signal: AbortSignal,
) {
  const directory = await Directory.pickDirectoryAsync();
  if (signal.aborted) return;
  const cached = await downloadGalleryImage(environmentId, image, signal);
  if (!cached) return;
  try {
    if (!signal.aborted) await new File(cached.uri).copy(new File(directory, image.fileName));
  } finally {
    cached.dispose();
  }
}
