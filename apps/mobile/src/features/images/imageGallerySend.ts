import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";

export async function prepareImageGalleryMessage(
  message: QueuedThreadMessage,
  source: {
    signal: AbortSignal;
    prepare: () => Promise<DraftComposerImageAttachment | null>;
  } | null,
): Promise<QueuedThreadMessage | null> {
  if (!source) return message;
  if (source.signal.aborted) return null;
  if (message.attachments.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
    throw new Error("Too many attachments");
  const image = await source.prepare();
  if (source.signal.aborted || !image) return null;
  return { ...message, attachments: [image, ...message.attachments] };
}
