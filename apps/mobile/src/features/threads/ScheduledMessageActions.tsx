import { useRef } from "react";
import { Pressable } from "react-native";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import {
  threadOutboxRevision,
  updateThreadOutboxMessage,
  type QueuedThreadMessage,
} from "../../state/thread-outbox";
import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";
import {
  dispatchingQueuedMessageIdAtom,
  holdEditingQueuedMessage,
  releaseEditingQueuedMessage,
} from "../../state/use-thread-outbox";

export function ScheduledMessageActions(props: { readonly message: QueuedThreadMessage }) {
  const { message } = props;
  const canOperate = useEnvironmentScope(message.environmentId, AuthOrchestrationOperateScope);
  const busy = useRef(false);
  const act = async (action: string) => {
    if (
      busy.current ||
      !readEnvironmentScope(message.environmentId, AuthOrchestrationOperateScope) ||
      appAtomRegistry.get(dispatchingQueuedMessageIdAtom) === message.messageId
    )
      return;
    busy.current = true;
    holdEditingQueuedMessage(message.messageId);
    const revision = threadOutboxRevision(message.messageId);
    try {
      if (action === "cancel") await removeThreadOutboxMessage(message, revision);
      else if (action === "send") {
        const { scheduledAt: _, ...immediate } = message;
        await updateThreadOutboxMessage(immediate, revision);
      }
    } catch (error) {
      Dialog.alert(
        "Could not change scheduled message",
        error instanceof Error ? error.message : String(error),
      );
    }
    busy.current = false;
    releaseEditingQueuedMessage(message.messageId);
  };
  return (
    <Menu
      actions={[
        { id: "send", title: "Send now", attributes: { disabled: !canOperate } },
        {
          id: "cancel",
          title: "Cancel scheduled send",
          attributes: { disabled: !canOperate, destructive: true },
        },
      ]}
      onPressAction={({ nativeEvent }) => void act(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scheduled message actions"
        className="py-1"
      >
        <Text className="font-t3-medium text-xs text-foreground-secondary">
          Scheduled ·{" "}
          {new Date(message.scheduledAt!).toLocaleString([], {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </Text>
      </Pressable>
    </Menu>
  );
}
