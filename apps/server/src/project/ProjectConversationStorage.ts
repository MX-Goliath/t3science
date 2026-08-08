import type {
  ProjectConversationStorageError,
  ProjectConversationStorageState,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

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

export class ProjectConversationStorage extends Context.Service<
  ProjectConversationStorage,
  ProjectConversationStorageShape
>()("t3/project/ProjectConversationStorage") {}
