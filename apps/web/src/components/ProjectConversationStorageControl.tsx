import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readLocalApi } from "../localApi";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { Switch } from "./ui/switch";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function ProjectConversationStorageControl({
  member,
}: {
  member: SidebarProjectGroupMember;
}) {
  const queryAtom = useMemo(
    () =>
      projectEnvironment.conversationStorage({
        environmentId: member.environmentId,
        input: { projectId: member.id },
      }),
    [member.environmentId, member.id],
  );
  const state = useEnvironmentQuery(queryAtom);
  const setConversationStorage = useAtomCommand(projectEnvironment.setConversationStorage, {
    reportFailure: false,
  });
  const [saving, setSaving] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);
  const enabled = optimisticEnabled ?? state.data?.enabled ?? false;

  useEffect(() => {
    if (state.data?.enabled === optimisticEnabled) setOptimisticEnabled(null);
  }, [optimisticEnabled, state.data?.enabled]);

  const updateEnabled = useCallback(
    async (nextEnabled: boolean) => {
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
    },
    [member.environmentId, member.id, setConversationStorage, state],
  );

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/70 px-3 py-3 dark:border-transparent dark:bg-white/[0.035]">
      <div className="min-w-0">
        <p className="font-medium text-foreground">Portable local conversations</p>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          Save and automatically restore this project&apos;s conversations from{" "}
          <code>.t3/conversations</code>. Imported conversations continue in a new provider session
          with their previous message context.
        </p>
        {state.error ? <p className="mt-1 text-sm text-destructive">{state.error}</p> : null}
      </div>
      <Switch
        checked={enabled}
        disabled={saving || state.isPending}
        aria-label="Save conversations in the project directory"
        onCheckedChange={(checked) => void updateEnabled(Boolean(checked))}
      />
    </div>
  );
}
