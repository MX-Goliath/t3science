import type { WebChatProvider } from "@t3tools/contracts/settings";

export const WEB_CHAT_PROVIDERS = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  claude: { label: "Claude", url: "https://claude.ai/new" },
  grok: { label: "Grok", url: "https://grok.com/" },
  perplexity: { label: "Perplexity", url: "https://www.perplexity.ai/" },
} as const satisfies Record<WebChatProvider, { readonly label: string; readonly url: string }>;

export function getWebChatProviderDefinition(provider: WebChatProvider) {
  return WEB_CHAT_PROVIDERS[provider];
}
