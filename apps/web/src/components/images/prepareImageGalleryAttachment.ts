import { ChatAttachmentId, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { prepareImageForAttachment, readFileAsDataUrl } from "~/lib/imageCompression";
import { randomUUID } from "~/lib/utils";
import type { GalleryImage } from "./imageGalleryTypes";

export async function prepareImageGalleryAttachment(
  image: GalleryImage,
  url: string,
  signal: AbortSignal,
) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Image download failed");
  const blob = await response.blob();
  const prepared = await prepareImageForAttachment(
    new File([blob], image.fileName, { type: blob.type || "image/png" }),
    PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  );
  if (!prepared.ok) throw new Error("Image preparation failed");
  const file = new File([prepared.file], image.fileName, { type: prepared.file.type });
  const previewUrl = await readFileAsDataUrl(file);
  return {
    id: ChatAttachmentId.make(randomUUID()),
    type: "image" as const,
    name: image.fileName,
    mimeType: file.type,
    sizeBytes: file.size,
    file,
    previewUrl,
  };
}
