import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  PortableConversationContext,
  type PortableConversationContextShape,
} from "../Services/PortableConversationContext.ts";

export const makePortableConversationContext = Effect.gen(function* () {
  const eventStore = yield* OrchestrationEventStore;
  const pending = yield* Ref.make(new Set<ThreadId>());

  yield* Stream.runForEach(eventStore.readAll(), (event) =>
    event.type === "thread.portable-imported"
      ? Ref.update(pending, (current) => new Set(current).add(event.payload.thread.id))
      : event.type === "thread.portable-context-restored"
        ? Ref.update(pending, (current) => {
            const next = new Set(current);
            next.delete(event.payload.threadId);
            return next;
          })
        : Effect.void,
  );

  const markPending: PortableConversationContextShape["markPending"] = (threadId) =>
    Ref.update(pending, (current) => new Set(current).add(threadId));
  const markRestored: PortableConversationContextShape["markRestored"] = (threadId) =>
    Ref.update(pending, (current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });

  return PortableConversationContext.of({
    isPending: (threadId) => Ref.get(pending).pipe(Effect.map((current) => current.has(threadId))),
    markPending,
    markRestored,
  });
});

export const PortableConversationContextLive = Layer.effect(
  PortableConversationContext,
  makePortableConversationContext,
);
