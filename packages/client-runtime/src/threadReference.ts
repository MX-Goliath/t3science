import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import type {
  ComposerContextClipboardFragment,
  ScopedThreadRef,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { hostedThreadLink } from "@t3tools/shared/threadLinks";

import { resolveThreadCurrentPullRequestLink } from "./threadPullRequests.ts";

export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  /** The plain text: a PR URL, or a link that opens the thread from anywhere. */
  readonly value: string;
  /** What a toast or palette row shows for the copy. */
  readonly description: string;
  /** T3's clipboard format, which pastes a thread back into a composer as a chip. */
  readonly fragment?: ComposerContextClipboardFragment;
  readonly clipboardTarget: string;
  readonly successTitle: string;
  readonly failureTitle: string;
}

/**
 * A link that opens the thread from anywhere, through `hostedAppUrl`, this build's hosted app. It
 * pastes back as a chip into any composer whose agent reads that thread's machine.
 */
export function threadChipCopyTarget(
  threadRef: ScopedThreadRef,
  title: string,
  hostedAppUrl?: string,
): ThreadReferenceCopyTarget {
  const record = threadContextRecord(threadRef, title);
  return {
    kind: "thread",
    value: hostedThreadLink(threadRef, hostedAppUrl),
    description: record.title,
    fragment: { version: 1, source: { environmentId: threadRef.environmentId }, records: [record] },
    clipboardTarget: "thread",
    successTitle: "Thread copied",
    failureTitle: "Failed to copy thread",
  };
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  /** Undefined means no PR panel; null means its URL is not available yet. */
  readonly openPanelPullRequestUrl?: string | null | undefined;
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequestUrl?: string | null;
  readonly hostedAppUrl?: string;
}): ThreadReferenceCopyTarget | null {
  if (input.openPanelPullRequestUrl === null) return null;
  const pullRequestUrl =
    input.openPanelPullRequestUrl ??
    resolveThreadCurrentPullRequestLink(input.pullRequests ?? [])?.url ??
    input.linkedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        description: pullRequestUrl,
        clipboardTarget: "pull request link",
        successTitle: "PR link copied",
        failureTitle: "Failed to copy PR link",
      }
    : threadChipCopyTarget(input.threadRef, input.title, input.hostedAppUrl);
}

export function networkThreadCopyTarget(
  target: ThreadReferenceCopyTarget,
  baseUrls: ReadonlyArray<string>,
): ThreadReferenceCopyTarget {
  if (target.kind !== "thread") return target;
  const record = target.fragment?.records.find((record) => record.kind === "thread");
  const origins = baseUrls.flatMap((value) => {
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        isLocalLoopbackHost(url.hostname) ||
        url.hostname.endsWith(".localhost") ||
        ["0.0.0.0", "[::]", "app.t3.codes"].includes(url.hostname)
      )
        return [];
      return [url.origin];
    } catch {
      return [];
    }
  });
  const origin = origins.find((origin) => origin.startsWith("https:")) ?? origins[0];
  if (!record || record.kind !== "thread" || !("threadId" in record) || !origin) {
    throw new Error("Enable network access in Connections settings before sharing this thread.");
  }
  return { ...target, value: hostedThreadLink(record, origin) };
}
