import { ThreadId, type OrchestrationEvent } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { makePortableConversationContext } from "./PortableConversationContext.ts";

const importedEvent = (sequence: number, threadId: ThreadId) =>
  ({
    sequence,
    type: "thread.portable-imported",
    payload: { thread: { id: threadId } },
  }) as OrchestrationEvent;

const restoredEvent = (sequence: number, threadId: ThreadId) =>
  ({
    sequence,
    type: "thread.portable-context-restored",
    payload: { threadId },
  }) as OrchestrationEvent;

describe("PortableConversationContext", () => {
  it.effect("rebuilds pending continuation state from durable import events", () =>
    Effect.gen(function* () {
      const first = ThreadId.make("portable-first");
      const second = ThreadId.make("portable-second");
      const context = yield* makePortableConversationContext.pipe(
        Effect.provide(
          Layer.mock(OrchestrationEventStore)({
            readAll: () =>
              Stream.fromIterable([
                importedEvent(1, first),
                importedEvent(2, second),
                restoredEvent(3, first),
              ]),
          }),
        ),
      );

      expect(yield* context.isPending(first)).toBe(false);
      expect(yield* context.isPending(second)).toBe(true);

      yield* context.markRestored(second);
      expect(yield* context.isPending(second)).toBe(false);
      yield* context.markPending(first);
      expect(yield* context.isPending(first)).toBe(true);
    }),
  );
});
