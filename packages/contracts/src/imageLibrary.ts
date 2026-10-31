import * as Schema from "effect/Schema";
import { MessageId, NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
const ImageLibraryOrigin = Schema.Struct({
  threadId: ThreadId,
  messageId: Schema.NullOr(MessageId),
});

export const ImageLibraryEntry = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  directory: Schema.String,
  fileName: Schema.String,
  createdAt: Schema.Number,
  sizeBytes: NonNegativeInt,
  nativeThreadId: Schema.String,
  providerInstanceId: ProviderInstanceId,
  origin: Schema.NullOr(ImageLibraryOrigin),
});
export type ImageLibraryEntry = typeof ImageLibraryEntry.Type;

export const ImageLibraryListInput = Schema.Struct({
  offset: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(NonNegativeInt.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type ImageLibraryListInput = typeof ImageLibraryListInput.Type;
export const ImageLibraryListResult = Schema.Struct({
  images: Schema.Array(ImageLibraryEntry),
  nextOffset: Schema.NullOr(NonNegativeInt),
  directories: Schema.Array(Schema.Struct({ path: Schema.String, label: Schema.String })),
});
export type ImageLibraryListResult = typeof ImageLibraryListResult.Type;
export const ImageLibraryConversationInput = Schema.Struct({ id: Schema.String });
export const ImageLibraryConversation = Schema.Struct({
  origin: Schema.NullOr(ImageLibraryOrigin),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
      createdAt: Schema.Number,
    }),
  ),
  imageMessageIndex: Schema.NullOr(NonNegativeInt),
});
export type ImageLibraryConversation = typeof ImageLibraryConversation.Type;
export class ImageLibraryError extends Schema.TaggedError<ImageLibraryError>()(
  "ImageLibraryError",
  {
    operation: Schema.Literals(["list", "conversation"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return "Could not read the image library.";
  }
}
