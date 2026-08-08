import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface PortableConversationContextShape {
  readonly isPending: (threadId: ThreadId) => Effect.Effect<boolean>;
  readonly markPending: (threadId: ThreadId) => Effect.Effect<void>;
  readonly markRestored: (threadId: ThreadId) => Effect.Effect<void>;
}

export class PortableConversationContext extends Context.Reference<PortableConversationContextShape>(
  "t3/orchestration/Services/PortableConversationContext",
  {
    defaultValue: () => ({
      isPending: () => Effect.succeed(false),
      markPending: () => Effect.void,
      markRestored: () => Effect.void,
    }),
  },
) {}
