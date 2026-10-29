import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";

import { readLocalApi } from "../localApi";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "./ui/toast";

export interface ProjectConversationStorageState {
  readonly enabled: boolean;
  /** A write is in flight, or the current value has not loaded yet. */
  readonly busy: boolean;
  readonly error: string | null;
  readonly setEnabled: (enabled: boolean) => void;
}

export function useProjectConversationStorage(
  member: SidebarProjectGroupMember,
): ProjectConversationStorageState {
  const queryAtom = projectEnvironment.conversationStorage({
    environmentId: member.environmentId,
    input: { projectId: member.id },
  });
  const state = useEnvironmentQuery(queryAtom);
  const canSetStorage = useAtomValue(
    projectEnvironment.setConversationStorage.permissionAtom(member.environmentId),
  );
  const setConversationStorage = useAtomCommand(projectEnvironment.setConversationStorage, {
    reportFailure: false,
  });
  const [saving, setSaving] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);
  const enabled = optimisticEnabled ?? state.data?.enabled ?? false;

  if (optimisticEnabled !== null && state.data?.enabled === optimisticEnabled) {
    setOptimisticEnabled(null);
  }

  const updateEnabled = async (nextEnabled: boolean) => {
    if (!canSetStorage) return;
    if (nextEnabled) {
      const confirmed = await readLocalApi()?.dialogs.confirm(
        [
          "Save this project's conversations inside the project directory?",
          "Existing conversations and image attachments will be copied to .t3/conversations. Conversation text can contain sensitive data.",
        ].join("\n\n"),
      );
      if (!confirmed) return;
    }

    setSaving(true);
    const result = await setConversationStorage({
      environmentId: member.environmentId,
      input: { projectId: member.id, enabled: nextEnabled },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update local conversation storage",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return;
    }

    setOptimisticEnabled(result.value.enabled);
    state.refresh();
    toastManager.add({
      type: "success",
      title: result.value.enabled
        ? "Local conversation storage enabled"
        : "Local conversation storage disabled",
      description: result.value.enabled
        ? `${result.value.exportedThreadCount} conversation${result.value.exportedThreadCount === 1 ? "" : "s"} saved to .t3/conversations.`
        : "Existing exported files were kept, but they will no longer be updated or imported automatically.",
    });
  };

  return {
    enabled,
    busy: saving || state.isPending || !canSetStorage,
    error: state.error ?? null,
    setEnabled: (nextEnabled: boolean) => void updateEnabled(nextEnabled),
  };
}

export const PORTABLE_CONVERSATIONS_SWITCH_LABEL = "Save conversations in the project directory";
