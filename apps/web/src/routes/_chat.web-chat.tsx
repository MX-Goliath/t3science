import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import { useWebChatBrowserStore } from "~/browser/webChatBrowserStore";
import { previewBridge } from "~/components/preview/previewBridge";
import { WebChatProviderIcon } from "~/components/web-chat/WebChatProviderIcon";
import { isElectron } from "~/env";
import { useClientSettings } from "~/hooks/useSettings";
import { WEB_CHAT_BROWSER_TAB_ID, getWebChatProviderDefinition } from "~/webChat";

import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { cn } from "~/lib/utils";

function WebChatRouteView() {
  const { enabled, provider } = useClientSettings((settings) => ({
    enabled: settings.webChatEnabled,
    provider: settings.webChatProvider,
  }));
  const navigation = useWebChatBrowserStore((state) => state.navigation);
  const definition = getWebChatProviderDefinition(provider);
  const bridge = previewBridge;

  if (!isElectron || !enabled || !bridge) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle>Web chat is unavailable</EmptyTitle>
            <EmptyDescription>
              Enable Web chat in the desktop app’s General settings. Provider sites cannot be
              embedded safely in the regular web client.
            </EmptyDescription>
            <Button render={<Link to="/settings/general" />} size="sm" className="mt-4">
              Open settings
            </Button>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-10 shrink-0 items-center gap-2 border-b border-border px-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex items-center gap-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Go back"
              disabled={!navigation?.canGoBack}
              onClick={() => void bridge.goBack(WEB_CHAT_BROWSER_TAB_ID)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Go forward"
              disabled={!navigation?.canGoForward}
              onClick={() => void bridge.goForward(WEB_CHAT_BROWSER_TAB_ID)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Reload ${definition.label}`}
              onClick={() => void bridge.refresh(WEB_CHAT_BROWSER_TAB_ID)}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-medium">
            <WebChatProviderIcon provider={provider} className="size-4 shrink-0" />
            <span className="truncate">{definition.label}</span>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Open ${definition.label} in default browser`}
            onClick={() => void window.desktopBridge?.openExternal(definition.url)}
          >
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        </header>
        <BrowserSurfaceSlot tabId={WEB_CHAT_BROWSER_TAB_ID} visible className="min-h-0 flex-1" />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/web-chat")({
  component: WebChatRouteView,
});
