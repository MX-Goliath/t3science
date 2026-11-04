import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import {
  decodeComposerContextFragment,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { threadLinkContextReferences } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadReferenceCopyTarget, networkThreadCopyTarget } from "./threadReference.ts";

const thread = {
  threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("thread-1") },
  title: "Fix the login flow",
};

const crossRepositoryPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "other/repo",
  number: 42,
  url: "https://github.com/other/repo/pull/42",
  source: "manual",
  linkedAt: "2026-01-01T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

describe("resolveThreadReferenceCopyTarget", () => {
  it("does not copy another reference while the open panel URL is unavailable", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        openPanelPullRequestUrl: null,
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toBeNull();
  });

  it("prefers the open panel pull request over the thread pull request", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        openPanelPullRequestUrl: "https://github.com/t3/pr/14",
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/t3/pr/14",
      successTitle: "PR link copied",
    });
  });

  it.each([null, "https://github.com/t3/pr/12"])(
    "copies a native cross-repository link before the fallback URL %s",
    (linkedPullRequestUrl) => {
      expect(
        resolveThreadReferenceCopyTarget({
          ...thread,
          pullRequests: [crossRepositoryPullRequest],
          linkedPullRequestUrl,
        }),
      ).toMatchObject({
        kind: "pull-request",
        value: crossRepositoryPullRequest.url,
      });
    },
  );

  it("uses the fallback URL when native links are dismissed", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        pullRequests: [{ ...crossRepositoryPullRequest, source: "stack-dismissed" }],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toMatchObject({ kind: "pull-request", value: "https://github.com/t3/pr/12" });
  });

  it("copies a thread chip that pastes back as the same thread on its machine", () => {
    const target = resolveThreadReferenceCopyTarget({ ...thread, linkedPullRequestUrl: null });

    expect(target).toMatchObject({
      kind: "thread",
      description: "Fix the login flow",
      successTitle: "Thread copied",
    });
    const pasted = decodeComposerContextFragment(encodeComposerContextFragment(target!.fragment!));
    expect(pasted).toEqual({
      version: 1,
      source: { environmentId: "env-1" },
      records: [
        expect.objectContaining({
          kind: "thread",
          environmentId: "env-1",
          threadId: "thread-1",
          title: "Fix the login flow",
        }),
      ],
    });
    // The plain text opens the thread anywhere and pastes back as the copied record's chip.
    expect(target!.value).toBe("https://app.t3.codes/threads/env-1/thread-1");
    expect(threadLinkContextReferences(target!.value, pasted!.records, () => undefined)).toEqual({
      text: `[Fix the login flow](t3-context://v1/thread/${pasted!.records[0]!.contextId})`,
      records: pasted!.records,
    });
  });

  it("links through the build's hosted app", () => {
    expect(
      resolveThreadReferenceCopyTarget({ ...thread, hostedAppUrl: "https://preview.t3.codes" })
        ?.value,
    ).toBe("https://preview.t3.codes/threads/env-1/thread-1");
  });
});

describe("network thread copies", () => {
  it.each([
    [["http://127.0.0.1:3773", "https://science.lan:7443"], "https://science.lan:7443"],
    [["http://192.168.1.20:3773", "https://science.lan"], "https://science.lan"],
    [["http://192.168.1.20:3773"], "http://192.168.1.20:3773"],
    [["http://[fd00::1]:3773"], "http://[fd00::1]:3773"],
    [["https://user:password@science.lan/path?token=secret#fragment"], "https://science.lan"],
  ])("uses a network URL from %j", (urls, origin) => {
    const target = resolveThreadReferenceCopyTarget(thread)!;
    const copy = networkThreadCopyTarget(target, urls);
    expect(copy.value).toBe(`${origin}/threads/env-1/thread-1`);
    expect(copy.fragment).toEqual(target.fragment);
    expect(
      threadLinkContextReferences(copy.value, copy.fragment!.records, () => undefined).records,
    ).toEqual(copy.fragment!.records);
  });

  it("refuses to share a device-local or unrelated hosted address", () => {
    const target = resolveThreadReferenceCopyTarget(thread)!;
    expect(() =>
      networkThreadCopyTarget(target, [
        "http://localhost:3773",
        "t3science://app",
        "http://0.0.0.0:3773",
        "https://app.t3.codes",
      ]),
    ).toThrow(/network/i);
    const pr = resolveThreadReferenceCopyTarget({
      ...thread,
      linkedPullRequestUrl: "https://github.com/a/b/pull/1",
    })!;
    expect(networkThreadCopyTarget(pr, [])).toBe(pr);
  });
});
