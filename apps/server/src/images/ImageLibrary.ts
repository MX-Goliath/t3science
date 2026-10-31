import {
  ImageLibraryError,
  MessageId,
  ThreadId,
  type ImageLibraryEntry,
  type ImageLibraryListInput,
  type ImageLibraryListResult,
  type ImageLibraryConversation,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { discoverCodexImages } from "./codexImageFiles.ts";
import { readCodexImageTranscript } from "./codexImageTranscript.ts";

export class ImageLibrary extends Context.Service<
  ImageLibrary,
  {
    readonly list: (
      input: ImageLibraryListInput,
    ) => Effect.Effect<ImageLibraryListResult, ImageLibraryError>;
    readonly conversation: (
      id: string,
    ) => Effect.Effect<ImageLibraryConversation, ImageLibraryError>;
  }
>()("t3/images/ImageLibrary") {}

const encodeImagePage = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        nativeThreadId: Schema.String,
        providerInstanceId: Schema.String,
        fileName: Schema.String,
      }),
    ),
  ),
);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const dependencies = yield* Effect.context<
    | Effect.Services<ReturnType<typeof discoverCodexImages>>
    | Effect.Services<ReturnType<typeof readCodexImageTranscript>>
  >();
  const discovery = yield* Effect.cachedWithTTL(
    discoverCodexImages().pipe(Effect.provideContext(dependencies)),
    "15 seconds",
  );

  const list = Effect.fn("ImageLibrary.list")(
    function* (input: ImageLibraryListInput) {
      const snapshot = yield* discovery;
      const offset = input.offset ?? 0;
      const page = snapshot.images.slice(offset, offset + (input.limit ?? 60));
      const encodedPage = yield* encodeImagePage(page);
      const origins =
        page.length === 0
          ? []
          : yield* sql<{
              id: string;
              thread_id: string;
              message_id: string | null;
            }>`
      SELECT json_extract(image.value, '$.id') AS id, provider.thread_id,
        (SELECT message.message_id FROM orchestration_v2_projection_messages AS message
          WHERE message.thread_id = provider.thread_id
            AND instr(message.payload_json, json_extract(image.value, '$.fileName')) > 0
          ORDER BY message.created_at ASC LIMIT 1) AS message_id
      FROM json_each(${encodedPage}) AS image
      JOIN orchestration_v2_projection_provider_threads AS provider
        ON json_extract(provider.payload_json, '$.nativeThreadRef.nativeId') = json_extract(image.value, '$.nativeThreadId')
          AND provider.driver = 'codex'
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = provider.thread_id
      WHERE json_extract(thread.payload_json, '$.deletedAt') IS NULL
    `;
      const byId = new Map(origins.map((origin) => [origin.id, origin]));
      return {
        images: page.map(({ home: _, ...image }): ImageLibraryEntry => {
          const origin = byId.get(image.id);
          return {
            ...image,
            origin: origin
              ? {
                  threadId: ThreadId.make(origin.thread_id),
                  messageId: origin.message_id ? MessageId.make(origin.message_id) : null,
                }
              : null,
          };
        }),
        nextOffset: offset + page.length < snapshot.images.length ? offset + page.length : null,
        directories: snapshot.directories,
      };
    },
    (effect) =>
      effect.pipe(Effect.mapError((cause) => new ImageLibraryError({ operation: "list", cause }))),
  );

  const conversation = Effect.fn("ImageLibrary.conversation")(
    function* (id: string) {
      const snapshot = yield* discovery;
      const image = snapshot.images.find((entry) => entry.id === id);
      if (!image) return { messages: [], imageMessageIndex: null, origin: null };
      const { generatedAt, imageNativeTurnId, ...conversation } = yield* readCodexImageTranscript(
        image,
      ).pipe(Effect.provideContext(dependencies));
      const [origin] = yield* sql<{ thread_id: string; message_id: string | null }>`
        SELECT provider.thread_id, message.message_id
        FROM orchestration_v2_projection_provider_threads AS provider
        JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = provider.thread_id
        LEFT JOIN orchestration_v2_projection_provider_turns AS turn
          ON turn.provider_thread_id = provider.provider_thread_id
            AND json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') = ${imageNativeTurnId}
        LEFT JOIN orchestration_v2_projection_run_attempts AS attempt ON attempt.attempt_id = turn.run_attempt_id
        LEFT JOIN orchestration_v2_projection_messages AS message ON message.thread_id = provider.thread_id
          AND (message.run_id = attempt.run_id OR attempt.run_id IS NULL)
        WHERE provider.driver = 'codex'
          AND json_extract(provider.payload_json, '$.nativeThreadRef.nativeId') = ${image.nativeThreadId}
          AND json_extract(thread.payload_json, '$.deletedAt') IS NULL
        ORDER BY CASE WHEN instr(message.payload_json, ${image.fileName}) > 0 THEN 0 ELSE 1 END,
          CASE WHEN message.role = 'assistant' THEN 0 ELSE 1 END,
          abs((julianday(message.created_at) - 2440587.5) * 86400000 - ${generatedAt ?? image.createdAt}) ASC
        LIMIT 1
      `;
      return {
        origin: origin
          ? {
              threadId: ThreadId.make(origin.thread_id),
              messageId: origin.message_id ? MessageId.make(origin.message_id) : null,
            }
          : null,
        ...conversation,
      };
    },
    (effect) =>
      effect.pipe(
        Effect.mapError((cause) => new ImageLibraryError({ operation: "conversation", cause })),
      ),
  );
  return ImageLibrary.of({ list, conversation });
});
export const layer = Layer.effect(ImageLibrary, make);
