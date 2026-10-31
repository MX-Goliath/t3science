import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { View } from "react-native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import * as Dialog from "../../../components/ui/Dialog";
import { AppText as Text } from "../../../components/ui/AppText";
import { projectEnvironment } from "../../../state/projects";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

export function ProjectConversationStorage(props: {
  readonly project: EnvironmentProject;
  readonly environmentLabel: string;
}) {
  const { project } = props;
  const query = useEnvironmentQuery(
    projectEnvironment.conversationStorage({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }),
  );
  const canChange = useAtomValue(
    projectEnvironment.setConversationStorage.permissionAtom(project.environmentId),
  );
  const setStorage = useAtomCommand(projectEnvironment.setConversationStorage, {
    reportFailure: false,
  });
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  if (confirmed !== null && query.data?.enabled === confirmed) setConfirmed(null);

  const save = async (enabled: boolean) => {
    if (pending.current || !canChange) return;
    pending.current = true;
    setSaving(true);
    const attempt = await settlePromise(() =>
      setStorage({
        environmentId: project.environmentId,
        input: { projectId: project.id, enabled },
      }),
    );
    pending.current = false;
    setSaving(false);
    const result = attempt._tag === "Failure" ? attempt : attempt.value;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Dialog.alert(
          "Could not update conversation storage",
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
    setConfirmed(result.value.enabled);
    query.refresh();
  };

  const change = (enabled: boolean) => {
    if (!enabled) {
      void save(false);
      return;
    }
    Dialog.confirm({
      title: "Save conversations in the project?",
      message:
        "Existing conversations and attachments will be copied to .t3/conversations on this environment. Conversation text can contain sensitive data.",
      confirmText: "Enable",
      onConfirm: () => void save(true),
    });
  };

  return (
    <View>
      <SettingsSwitchRow
        label={`Save conversations · ${props.environmentLabel}`}
        subtitle="Keep portable conversations in .t3/conversations inside this checkout. Turning this off keeps existing exports."
        value={confirmed ?? query.data?.enabled ?? false}
        disabled={saving || query.isPending || query.data === null || !canChange}
        onValueChange={change}
      />
      {query.error ? (
        <Text className="px-4 pb-4 text-sm text-danger-foreground">{query.error}</Text>
      ) : null}
    </View>
  );
}
