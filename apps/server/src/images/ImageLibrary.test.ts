import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { MessageId, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ImageLibrary from "./ImageLibrary.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeEffect = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

it.effect("lists every configured Codex home once and preserves the source conversation", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    const shadow = path.join(root, "shadow");
    const disabled = path.join(root, "disabled");
    for (const home of [first, second, shadow, disabled])
      yield* fs.makeDirectory(path.join(home, "generated_images", "native-thread"), {
        recursive: true,
      });
    const firstImage = path.join(first, "generated_images/native-thread/a.png");
    yield* fs.writeFileString(firstImage, "image-a");
    yield* fs.writeFileString(
      path.join(first, "generated_images/native-thread/not-an-image.txt"),
      "ignored",
    );
    yield* fs.writeFileString(
      path.join(second, "generated_images/native-thread/b.webp"),
      "image-b",
    );
    yield* fs.writeFileString(path.join(shadow, "generated_images/native-thread/c.jpg"), "image-c");
    yield* fs.writeFileString(
      path.join(disabled, "generated_images/native-thread/private.png"),
      "disabled",
    );
    const alias = path.join(root, "alias");
    yield* fs.symlink(first, alias);
    const escape = path.join(root, "outside.png");
    yield* fs.writeFileString(escape, "outside");
    yield* fs.symlink(escape, path.join(first, "generated_images/native-thread/escape.png"));
    const nativeTranscript = path.join(first, "sessions/2026/10/31");
    yield* fs.makeDirectory(nativeTranscript, { recursive: true });
    yield* fs.writeFileString(
      path.join(nativeTranscript, "rollout-native-thread.jsonl"),
      [
        encode({
          type: "response_item",
          timestamp: "2026-10-31T10:00:00Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Draw a fox" }],
          },
        }),
        "{unfinished record",
        encode({
          type: "event_msg",
          timestamp: "2026-10-31T10:01:01Z",
          payload: {
            type: "item_completed",
            turn_id: "native-image-turn",
            item: { type: "ImageGeneration", id: "a", result: "x".repeat(2 * 1024 * 1024) },
          },
        }),
        encode({
          type: "response_item",
          timestamp: "2026-10-31T10:01:00Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Here is your fox" }],
          },
        }),
        encode({
          type: "response_item",
          payload: {
            type: "message",
            role: "tool",
            content: [{ type: "output_text", text: "not a conversation message" }],
          },
        }),
      ].join("\n"),
    );
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT, thread_id TEXT, provider_instance_id TEXT, driver TEXT, payload_json TEXT)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, payload_json TEXT)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_messages (thread_id TEXT, message_id TEXT, created_at TEXT, payload_json TEXT, run_id TEXT, role TEXT)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_provider_turns (provider_thread_id TEXT, run_attempt_id TEXT, payload_json TEXT)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_run_attempts (attempt_id TEXT, run_id TEXT)`;
      const nativeRef = yield* encodeEffect({
        nativeThreadRef: { nativeId: "native-thread" },
      });
      yield* sql`INSERT INTO orchestration_v2_projection_provider_threads VALUES ('provider-thread', 't3-thread', 'another-shared-account', 'codex', ${nativeRef})`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES ('t3-thread', '{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES ('t3-thread', 'image-message', '2026-10-31', '{"text":"Done"}', 'image-run', 'assistant')`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES ('t3-thread', 'wrong-message', '2026-10-31T10:01:01Z', '{"text":"Another turn"}', 'other-run', 'assistant')`;
      yield* sql`INSERT INTO orchestration_v2_projection_provider_turns VALUES ('provider-thread', 'attempt', '{"nativeTurnRef":{"nativeId":"native-image-turn"}}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_run_attempts VALUES ('attempt', 'image-run')`;
      const library = yield* ImageLibrary.ImageLibrary;
      const page = yield* library.list({ limit: 2 });
      const rest = yield* library.list({ offset: page.nextOffset!, limit: 2 });
      const images = [...page.images, ...rest.images];
      assert.deepStrictEqual(images.map((image) => image.fileName).sort(), [
        "a.png",
        "b.webp",
        "c.jpg",
        "private.png",
      ]);
      assert.equal(rest.nextOffset, null);
      assert.equal(page.directories.length, 4);
      const image = images.find((entry) => entry.fileName === "a.png")!;
      assert.deepStrictEqual(image.origin, {
        threadId: ThreadId.make("t3-thread"),
        messageId: null,
      });
      const conversation = yield* library.conversation(image.id);
      assert.deepStrictEqual(conversation.origin, {
        threadId: ThreadId.make("t3-thread"),
        messageId: MessageId.make("image-message"),
      });
      assert.deepStrictEqual(
        conversation.messages.map((message) => message.text),
        ["Draw a fox", "Here is your fox"],
      );
      assert.equal(conversation.imageMessageIndex, 1);
      assert.deepStrictEqual(yield* library.conversation(escape), {
        origin: null,
        messages: [],
        imageMessageIndex: null,
      });
    }).pipe(
      Effect.provide(
        ImageLibrary.layer.pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
          Layer.provide(
            ServerSettings.layerTest({
              providerInstances: {
                [ProviderInstanceId.make("codex")]: {
                  driver: ProviderDriverKind.make("codex"),
                  enabled: false,
                  config: { homePath: path.join(root, "missing") },
                },
                [ProviderInstanceId.make("first")]: {
                  driver: ProviderDriverKind.make("codex"),
                  config: { homePath: first, shadowHomePath: shadow },
                },
                [ProviderInstanceId.make("second")]: {
                  driver: ProviderDriverKind.make("codex"),
                  environment: [{ name: "CODEX_HOME", value: second, sensitive: false }],
                },
                [ProviderInstanceId.make("alias")]: {
                  driver: ProviderDriverKind.make("codex"),
                  config: { homePath: alias },
                },
                [ProviderInstanceId.make("disabled")]: {
                  driver: ProviderDriverKind.make("codex"),
                  enabled: false,
                  config: { homePath: disabled },
                },
              },
            }),
          ),
          Layer.provide(ServerConfig.layerTest(root, path.join(root, "state"))),
        ),
      ),
    );
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.Environment, {}),
    Effect.provide(NodeServices.layer),
  ),
);
