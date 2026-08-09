import type { WebChatProvider } from "@t3tools/contracts/settings";

export const WEB_CHAT_ROUTE = "/web-chat" as const;
export const WEB_CHAT_BROWSER_TAB_ID = "web-chat";

export interface WebChatProviderDefinition {
  readonly label: string;
  readonly url: string;
}

export const WEB_CHAT_PROVIDERS = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  claude: { label: "Claude", url: "https://claude.ai/new" },
  grok: { label: "Grok", url: "https://grok.com/" },
  perplexity: { label: "Perplexity", url: "https://www.perplexity.ai/" },
} as const satisfies Record<WebChatProvider, WebChatProviderDefinition>;

export function getWebChatProviderDefinition(provider: WebChatProvider): WebChatProviderDefinition {
  return WEB_CHAT_PROVIDERS[provider];
}

export function findMostRecentlyVisitedLocalProjectRoot(input: {
  readonly primaryEnvironmentId: string | null;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly environmentId: string;
    readonly workspaceRoot: string;
  }>;
  readonly threads: ReadonlyArray<{
    readonly projectId: string;
    readonly environmentId: string;
    readonly lastVisitedAt: string;
  }>;
}): string | null {
  if (input.primaryEnvironmentId === null) return null;
  const projectRoots = new Map(
    input.projects
      .filter((project) => project.environmentId === input.primaryEnvironmentId)
      .map((project) => [project.id, project.workspaceRoot] as const),
  );
  let latestVisitedAt = Number.NEGATIVE_INFINITY;
  let latestProjectRoot: string | null = null;
  for (const thread of input.threads) {
    if (thread.environmentId !== input.primaryEnvironmentId) continue;
    const projectRoot = projectRoots.get(thread.projectId);
    const visitedAt = Date.parse(thread.lastVisitedAt);
    if (!projectRoot || !Number.isFinite(visitedAt) || visitedAt <= latestVisitedAt) continue;
    latestVisitedAt = visitedAt;
    latestProjectRoot = projectRoot;
  }
  return latestProjectRoot;
}
