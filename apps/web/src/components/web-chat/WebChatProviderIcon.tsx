import type { WebChatProvider } from "@t3tools/contracts/settings";
import type { ComponentProps } from "react";

import { ClaudeAI, GrokIcon, OpenAI, Perplexity, type Icon } from "../Icons";

const WEB_CHAT_PROVIDER_ICONS = {
  chatgpt: OpenAI,
  claude: ClaudeAI,
  grok: GrokIcon,
  perplexity: Perplexity,
} as const satisfies Record<WebChatProvider, Icon>;

export function WebChatProviderIcon({
  provider,
  ...props
}: { readonly provider: WebChatProvider } & ComponentProps<"svg">) {
  const ProviderIcon = WEB_CHAT_PROVIDER_ICONS[provider];
  return <ProviderIcon {...props} />;
}
