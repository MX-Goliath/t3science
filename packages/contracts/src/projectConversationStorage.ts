import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationThread } from "./orchestration.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const PROJECT_CONVERSATION_STORAGE_DIRECTORY = ".t3/conversations";
export const PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION = 1;

export const ProjectConversationStorageGetInput = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectConversationStorageSetInput = Schema.Struct({
  projectId: ProjectId,
  enabled: Schema.Boolean,
});

export const ProjectConversationStorageState = Schema.Struct({
  projectId: ProjectId,
  enabled: Schema.Boolean,
  directory: TrimmedNonEmptyString,
  exportedThreadCount: NonNegativeInt,
});
export type ProjectConversationStorageState = typeof ProjectConversationStorageState.Type;

export class ProjectConversationStorageError extends Schema.TaggedErrorClass<ProjectConversationStorageError>()(
  "ProjectConversationStorageError",
  {
    message: TrimmedNonEmptyString,
  },
) {}

/**
 * A provider-neutral desktop conversation snapshot. Native provider resume
 * cursors are intentionally excluded because their backing files are local to
 * one machine. The importing desktop starts a fresh native session and seeds
 * it from the canonical message history instead.
 */
export const PortableConversationDocument = Schema.Struct({
  schemaVersion: Schema.Literal(PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION),
  exportedAt: TrimmedNonEmptyString,
  sourceProvider: Schema.NullOr(ProviderDriverKind),
  thread: OrchestrationThread,
});
export type PortableConversationDocument = typeof PortableConversationDocument.Type;
