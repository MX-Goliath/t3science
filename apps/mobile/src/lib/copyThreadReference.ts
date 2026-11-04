import * as Option from "effect/Option";
import { appAtomRegistry } from "../state/atom-registry";
import { serverEnvironment } from "../state/server";
import { environmentSession } from "../state/session";
import {
  networkThreadCopyTarget,
  type ThreadReferenceCopyTarget,
} from "@t3tools/client-runtime/thread-reference";
import * as Haptics from "expo-haptics";

import { writeComposerContextClipboard } from "./composerContextClipboard";
import { tryCopyTextWithHaptic } from "./copyTextWithHaptic";

/** Resolves false, after logging why, when the clipboard write fails. */
export async function copyThreadReference(target: ThreadReferenceCopyTarget): Promise<boolean> {
  if (!target.fragment)
    return tryCopyTextWithHaptic(target.value, { target: target.clipboardTarget });
  try {
    const environmentId = target.fragment.source.environmentId;
    const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
    const connection = Option.getOrNull(
      appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    target = networkThreadCopyTarget(target, [
      ...(config?.directEndpoints ?? [])
        .filter((endpoint) => endpoint.kind === "lan")
        .map((endpoint) => endpoint.httpBaseUrl),
      ...(connection && connection.target._tag !== "RelayConnectionTarget"
        ? [connection.httpBaseUrl]
        : []),
    ]);
    await writeComposerContextClipboard(target.value, target.fragment!);
  } catch (error) {
    console.error(`Failed to copy ${target.clipboardTarget} to the clipboard.`, error);
    return false;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  return true;
}
