import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "~/env";
import { useClientSettings } from "~/hooks/useSettings";
import { WEB_CHAT_ROUTE, getWebChatProviderDefinition } from "~/webChat";

import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { WebChatProviderIcon } from "./WebChatProviderIcon";

export function WebChatSidebarItem() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { enabled, provider } = useClientSettings((settings) => ({
    enabled: settings.webChatEnabled,
    provider: settings.webChatProvider,
  }));

  if (!isElectron || !enabled) return null;
  const definition = getWebChatProviderDefinition(provider);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pathname === WEB_CHAT_ROUTE}
        onClick={() => void navigate({ to: WEB_CHAT_ROUTE })}
        aria-label={`Open ${definition.label}`}
      >
        <WebChatProviderIcon provider={provider} className="size-4 shrink-0" />
        <span className="truncate">{definition.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
