import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { readPreparedConnection } from "../state/session";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import {
  networkThreadCopyTarget,
  type ThreadReferenceCopyTarget,
} from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";

export async function copyThreadReference(target: ThreadReferenceCopyTarget): Promise<void> {
  try {
    const environmentId = target.fragment?.source.environmentId;
    if (target.kind === "thread" && environmentId) {
      const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
      const connection = readPreparedConnection(environmentId);
      const desktopEndpoints =
        window.desktopBridge && environmentId === appAtomRegistry.get(primaryEnvironmentIdAtom)
          ? await window.desktopBridge.getAdvertisedEndpoints()
          : [];
      target = networkThreadCopyTarget(target, [
        ...desktopEndpoints
          .filter((endpoint) => endpoint.status === "available" && endpoint.reachability === "lan")
          .map((endpoint) => endpoint.httpBaseUrl),
        ...(config?.directEndpoints ?? [])
          .filter((endpoint) => endpoint.kind === "lan")
          .map((endpoint) => endpoint.httpBaseUrl),
        ...(connection && connection.target._tag !== "RelayConnectionTarget"
          ? [connection.httpBaseUrl]
          : []),
      ]);
    }
    const fragment = target.fragment ? encodeComposerContextFragment(target.fragment) : null;
    const didCopy = await writeTextToClipboard(
      target.value,
      target.clipboardTarget,
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
    if (!didCopy) return;
    toastManager.add({
      type: "success",
      title: target.successTitle,
      description: target.description,
    });
  } catch (error) {
    console.error(error);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: target.failureTitle,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}
