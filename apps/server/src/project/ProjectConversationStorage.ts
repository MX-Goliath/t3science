import type {
  ProjectConversationStorageError,
  ProjectConversationStorageState,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as EffectRuntime from "effect/Effect";
import { PROJECT_CONVERSATION_STORAGE_DIRECTORY } from "@t3tools/contracts";

export interface ProjectConversationStorageShape {
  readonly getState: (
    projectId: ProjectId,
  ) => Effect.Effect<ProjectConversationStorageState, ProjectConversationStorageError>;
  readonly setEnabled: (input: {
    readonly projectId: ProjectId;
    readonly enabled: boolean;
  }) => Effect.Effect<ProjectConversationStorageState, ProjectConversationStorageError>;
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ProjectConversationStorage extends Context.Reference<ProjectConversationStorageShape>(
  "t3/project/ProjectConversationStorage",
  {
    defaultValue: () => ({
      getState: (projectId) =>
        EffectRuntime.succeed({
          projectId,
          enabled: false,
          directory: PROJECT_CONVERSATION_STORAGE_DIRECTORY,
          exportedThreadCount: 0,
        }),
      setEnabled: ({ projectId, enabled }) =>
        EffectRuntime.succeed({
          projectId,
          enabled,
          directory: PROJECT_CONVERSATION_STORAGE_DIRECTORY,
          exportedThreadCount: 0,
        }),
      start: () => EffectRuntime.void,
    }),
  },
) {}
