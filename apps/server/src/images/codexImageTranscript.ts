import type { ImageLibraryConversation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  createTranscriptJsonReader,
  createTranscriptJsonSelector,
  TranscriptJsonLimitError,
} from "../project/AgentSessionJson.ts";
import { findCodexImageTranscript, type DiscoveredCodexImage } from "./codexImageFiles.ts";

const TranscriptMessage = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.optional(Schema.String),
  payload: Schema.Struct({
    type: Schema.optional(Schema.String),
    role: Schema.optional(Schema.String),
    turn_id: Schema.optional(Schema.String),
    id: Schema.optional(Schema.String),
    call_id: Schema.optional(Schema.String),
    item: Schema.optional(
      Schema.Struct({ id: Schema.optional(Schema.String), type: Schema.optional(Schema.String) }),
    ),
    content: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.String,
          text: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
});
const decodeMessageValue = Schema.decodeUnknownOption(TranscriptMessage);
const selectMessage = createTranscriptJsonSelector(TranscriptMessage);

export const readCodexImageTranscript = Effect.fn("ImageLibrary.readCodexImageTranscript")(
  function* (image: DiscoveredCodexImage) {
    const fs = yield* FileSystem.FileSystem;
    const transcript = yield* findCodexImageTranscript(image);
    const messages: Array<ImageLibraryConversation["messages"][number]> = [];
    let generatedAt: number | null = null;
    let currentNativeTurnId: string | null = null;
    let imageNativeTurnId: string | null = null;
    if (transcript !== null) {
      let recordBytes = 0;
      const reserve = (bytes: number) => {
        recordBytes += bytes;
        if (recordBytes > 4 * 1024 * 1024)
          throw new TranscriptJsonLimitError("Conversation record exceeds the text limit");
      };
      let reader = createTranscriptJsonReader(reserve, selectMessage);
      const consume = () => {
        const parsed = decodeMessageValue(reader.finish());
        recordBytes = 0;
        reader = createTranscriptJsonReader(reserve, selectMessage);
        if (Option.isNone(parsed)) return;
        const { payload, timestamp } = parsed.value;
        const at = Date.parse(timestamp ?? "") || 0;
        if (payload.turn_id) currentNativeTurnId = payload.turn_id;
        const itemId = payload.item?.id ?? payload.call_id ?? payload.id;
        if (itemId && image.fileName.startsWith(`${itemId}.`)) {
          generatedAt = at;
          imageNativeTurnId = currentNativeTurnId;
        }
        if (
          parsed.value.type !== "response_item" ||
          payload.type !== "message" ||
          (payload.role !== "user" && payload.role !== "assistant")
        )
          return;
        const text = (payload.content ?? []).map((block) => block.text ?? "").join("\n");
        if (text) {
          if (messages.length >= 1000) {
            if (generatedAt !== null) return;
            messages.shift();
          }
          messages.push({ role: payload.role, text: text.slice(0, 128 * 1024), createdAt: at });
        }
      };
      yield* fs.stream(transcript, { bytesToRead: 4 * 1024 * 1024 * 1024 }).pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.try(() => {
            let start = 0;
            while (start < chunk.length) {
              const newline = chunk.indexOf("\n", start);
              reader.write(chunk.slice(start, newline === -1 ? chunk.length : newline));
              if (newline === -1) break;
              consume();
              start = newline + 1;
            }
          }),
        ),
      );
      yield* Effect.try(consume);
    }
    let imageMessageIndex: number | null = null;
    let nearest = Infinity;
    messages.forEach((message, index) => {
      const distance = Math.abs(message.createdAt - (generatedAt ?? image.createdAt));
      if (message.text.includes(image.fileName)) {
        imageMessageIndex = index;
        nearest = -1;
      } else if (distance < nearest) {
        imageMessageIndex = index;
        nearest = distance;
      }
    });
    const from = Math.max(0, (imageMessageIndex ?? 0) - 100);
    return {
      generatedAt,
      imageNativeTurnId,
      messages: messages.slice(from, from + 200),
      imageMessageIndex: imageMessageIndex === null ? null : imageMessageIndex - from,
    };
  },
);
