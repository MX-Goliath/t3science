import { describe, expect, it } from "vite-plus/test";

import {
  WEB_CHAT_PROVIDERS,
  findMostRecentlyVisitedLocalProjectRoot,
  getWebChatProviderDefinition,
} from "./webChat";

describe("web chat providers", () => {
  it("defines every supported provider", () => {
    expect(Object.keys(WEB_CHAT_PROVIDERS)).toEqual(["chatgpt", "claude", "grok", "perplexity"]);
  });

  it.each([
    ["chatgpt", "chatgpt.com"],
    ["claude", "claude.ai"],
    ["grok", "grok.com"],
    ["perplexity", "www.perplexity.ai"],
  ] as const)("opens %s on its official HTTPS host", (provider, hostname) => {
    const url = new URL(getWebChatProviderDefinition(provider).url);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(hostname);
  });
});

describe("web chat download directory", () => {
  const projects = [
    { id: "local-old", environmentId: "local", workspaceRoot: "/projects/old" },
    { id: "local-new", environmentId: "local", workspaceRoot: "/projects/new" },
    { id: "remote", environmentId: "remote", workspaceRoot: "/srv/remote" },
  ];

  it("uses the most recently visited project from the primary environment", () => {
    expect(
      findMostRecentlyVisitedLocalProjectRoot({
        primaryEnvironmentId: "local",
        projects,
        threads: [
          {
            projectId: "local-new",
            environmentId: "local",
            lastVisitedAt: "2026-08-09T10:00:00.000Z",
          },
          {
            projectId: "remote",
            environmentId: "remote",
            lastVisitedAt: "2026-08-09T11:00:00.000Z",
          },
          {
            projectId: "local-old",
            environmentId: "local",
            lastVisitedAt: "2026-08-09T09:00:00.000Z",
          },
        ],
      }),
    ).toBe("/projects/new");
  });

  it("falls back to the platform default without a visited local project", () => {
    expect(
      findMostRecentlyVisitedLocalProjectRoot({
        primaryEnvironmentId: "local",
        projects,
        threads: [
          {
            projectId: "remote",
            environmentId: "remote",
            lastVisitedAt: "2026-08-09T11:00:00.000Z",
          },
        ],
      }),
    ).toBeNull();
  });
});
