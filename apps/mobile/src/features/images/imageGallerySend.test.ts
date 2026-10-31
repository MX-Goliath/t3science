import { expect, it } from "vite-plus/test";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@t3tools/contracts";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import { prepareImageGalleryMessage } from "./imageGallerySend";

it("keeps the source outside the draft and drops preparation after navigation", async () => {
  const image: DraftComposerImageAttachment = {
    id: "source",
    type: "image",
    name: "photo.png",
    mimeType: "image/png",
    sizeBytes: 1,
    previewUri: "data:image/png;base64,AA==",
    dataUrl: "data:image/png;base64,AA==",
  };
  const draftAttachments: DraftComposerImageAttachment[] = [];
  const message = {
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    commandId: CommandId.make("command"),
    messageId: MessageId.make("message"),
    text: "Make the sky blue",
    attachments: draftAttachments,
    createdAt: "2026-10-31T00:00:00Z",
  };
  const prepared = await prepareImageGalleryMessage(message, {
    signal: new AbortController().signal,
    prepare: async () => image,
  });
  expect(prepared?.attachments).toEqual([image]);
  expect(message.attachments).toEqual([]);
  const controller = new AbortController();
  let finish!: (image: DraftComposerImageAttachment) => void;
  const pending = prepareImageGalleryMessage(message, {
    signal: controller.signal,
    prepare: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  controller.abort();
  finish(image);
  expect(await pending).toBeNull();
  expect(draftAttachments).toEqual([]);
  await expect(
    prepareImageGalleryMessage(
      {
        ...message,
        attachments: Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }, () => image),
      },
      { signal: new AbortController().signal, prepare: async () => image },
    ),
  ).rejects.toThrow("Too many attachments");
});
