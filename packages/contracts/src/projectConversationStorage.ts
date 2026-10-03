import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2TurnItemJson,
} from "./orchestrationV2.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { MessageId } from "./baseSchemas.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const PROJECT_CONVERSATION_STORAGE_DIRECTORY = ".t3/conversations";
export const PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION = 2;

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

export class ProjectConversationStorageError extends Schema.TaggedError<ProjectConversationStorageError>()(
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
const LegacyPortableThread = Schema.Struct({
  id: OrchestrationV2AppThreadJson.fields.id,
  projectId: OrchestrationV2AppThreadJson.fields.projectId,
  title: OrchestrationV2AppThreadJson.fields.title,
  modelSelection: OrchestrationV2AppThreadJson.fields.modelSelection,
  runtimeMode: OrchestrationV2AppThreadJson.fields.runtimeMode,
  interactionMode: OrchestrationV2AppThreadJson.fields.interactionMode,
  createdAt: OrchestrationV2AppThreadJson.fields.createdAt,
  updatedAt: OrchestrationV2AppThreadJson.fields.updatedAt,
  archivedAt: OrchestrationV2AppThreadJson.fields.archivedAt,
  settledOverride: OrchestrationV2AppThreadJson.fields.settledOverride,
  settledAt: OrchestrationV2AppThreadJson.fields.settledAt,
  deletedAt: OrchestrationV2AppThreadJson.fields.deletedAt,
  pinnedAt: OrchestrationV2AppThreadJson.fields.pinnedAt,
  pinOrderKey: OrchestrationV2AppThreadJson.fields.pinOrderKey,
  activeOrderKey: OrchestrationV2AppThreadJson.fields.activeOrderKey,
  snoozedAt: OrchestrationV2AppThreadJson.fields.snoozedAt,
  snoozedUntil: OrchestrationV2AppThreadJson.fields.snoozedUntil,
  unsettledAt: OrchestrationV2AppThreadJson.fields.unsettledAt,
  autoSettleDisabledAt: OrchestrationV2AppThreadJson.fields.autoSettleDisabledAt,
  linkedPullRequest: OrchestrationV2AppThreadJson.fields.linkedPullRequest,
  pullRequests: OrchestrationV2AppThreadJson.fields.pullRequests,
  branchPullRequest: OrchestrationV2AppThreadJson.fields.branchPullRequest,
  messages: Schema.Array(
    Schema.Struct({
      id: MessageId,
      role: Schema.Literals(["user", "assistant", "reasoning"]),
      text: Schema.String,
      modelSelection: Schema.optional(ModelSelection),
      attachments: Schema.optional(Schema.Array(ChatAttachment)),
      context: Schema.optional(OrchestrationMessageContext),
      createdAt: Schema.DateTimeUtcFromString,
      updatedAt: Schema.DateTimeUtcFromString,
    }),
  ),
});

export const LegacyPortableConversationDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  exportedAt: TrimmedNonEmptyString,
  sourceProvider: Schema.NullOr(ProviderDriverKind),
  thread: LegacyPortableThread,
});

export const PortableConversationV2Document = Schema.Struct({
  schemaVersion: Schema.Literal(PROJECT_CONVERSATION_STORAGE_SCHEMA_VERSION),
  exportedAt: TrimmedNonEmptyString,
  sourceProvider: Schema.NullOr(ProviderDriverKind),
  thread: OrchestrationV2AppThreadJson,
  messages: Schema.Array(OrchestrationV2ConversationMessageJson),
  turnItems: Schema.Array(OrchestrationV2TurnItemJson),
});
export const PortableConversationDocument = Schema.Union([
  LegacyPortableConversationDocument,
  PortableConversationV2Document,
]);
export type PortableConversationDocument = typeof PortableConversationDocument.Type;
