import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export interface TurnWorkspaceTarget {
  readonly threadId: ThreadId;
  readonly bootstrap?:
    | {
        readonly createThread?:
          | {
              readonly projectId: ProjectId;
              readonly worktreePath: string | null;
            }
          | undefined;
        readonly prepareWorktree?:
          | {
              readonly projectCwd: string;
            }
          | undefined;
      }
    | undefined;
}

const workspaceLookupError = (cause: unknown) =>
  new OrchestrationDispatchCommandError({
    message: "Failed to verify the thread workspace folder.",
    cause,
  });

export const ensureTurnWorkspaceAvailable = Effect.fn(
  "TurnWorkspaceAvailability.ensureTurnWorkspaceAvailable",
)(function* (target: TurnWorkspaceTarget) {
  const fileSystem = yield* FileSystem.FileSystem;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const workspaceRoot = yield* Effect.gen(function* () {
    if (target.bootstrap?.prepareWorktree) {
      return target.bootstrap.prepareWorktree.projectCwd;
    }

    const createThread = target.bootstrap?.createThread;
    if (createThread?.worktreePath) {
      return createThread.worktreePath;
    }
    if (createThread) {
      const project = yield* projectionSnapshotQuery.getProjectShellById(createThread.projectId);
      return Option.isSome(project) ? project.value.workspaceRoot : null;
    }

    const context = yield* projectionSnapshotQuery.getThreadCheckpointContext(target.threadId);
    return Option.isSome(context)
      ? (context.value.worktreePath ?? context.value.workspaceRoot)
      : null;
  }).pipe(Effect.mapError(workspaceLookupError));

  // Missing projects and threads are left to the decider so callers retain
  // its existing not-found errors. This guard is only responsible for a
  // workspace path that is known but no longer usable.
  if (workspaceRoot === null) {
    return;
  }

  const info = yield* fileSystem.stat(workspaceRoot).pipe(Effect.option);
  if (Option.isSome(info) && info.value.type === "Directory") {
    return;
  }

  return yield* new OrchestrationDispatchCommandError({
    message: "The thread workspace folder is unavailable. Restore it before sending a message.",
  });
});
