"use client";

import { EnvironmentId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { useClientSettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useProjects, useThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import {
  WEB_CHAT_BROWSER_TAB_ID,
  findMostRecentlyVisitedLocalProjectRoot,
  getWebChatProviderDefinition,
} from "~/webChat";

import { acquireDesktopTab, type AcquiredDesktopTab } from "./desktopTabLifetime";
import { resolveHostedBrowserWebviewWrapperStyle } from "./hostedBrowserWebviewStyle";
import { resolveBrowserSurfacePanelRect, useBrowserSurfaceStore } from "./browserSurfaceStore";
import { usePreviewWebviewConfig } from "./previewWebviewConfigState";
import { useWebChatBrowserStore } from "./webChatBrowserStore";

const HIDDEN_WEB_CHAT_SIZE = { width: 1280, height: 800 } as const;
// Browser partitions are derived from this scope by the desktop host. Keeping
// web-chat auth separate means project previews never share these cookies.
const WEB_CHAT_BROWSER_SESSION_SCOPE = EnvironmentId.make("web-chat");

export function WebChatBrowserHost() {
  const enabled = useClientSettings((settings) => settings.webChatEnabled);

  if (!enabled || !previewBridge) return null;
  return <MountedWebChatBrowser />;
}

function MountedWebChatBrowser() {
  const provider = useClientSettings((settings) => settings.webChatProvider);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const visitedThreads = useMemo(
    () =>
      threads.flatMap((thread) => {
        const lastVisitedAt =
          threadLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))];
        return lastVisitedAt ? [{ ...thread, lastVisitedAt }] : [];
      }),
    [threadLastVisitedAtById, threads],
  );
  const recentlyVisitedLocalProjectRoot = useMemo(
    () =>
      findMostRecentlyVisitedLocalProjectRoot({
        primaryEnvironmentId,
        projects,
        threads: visitedThreads,
      }),
    [primaryEnvironmentId, projects, visitedThreads],
  );
  const downloadDirectory = recentlyVisitedLocalProjectRoot;
  const config = usePreviewWebviewConfig(WEB_CHAT_BROWSER_SESSION_SCOPE);
  const tabLeaseRef = useRef<AcquiredDesktopTab | null>(null);
  const webviewRef = useRef<HTMLElementTagNameMap["webview"] | null>(null);
  const desiredUrlRef = useRef(getWebChatProviderDefinition(provider).url);
  const lastNavigatedUrlRef = useRef<string | null>(null);
  const [registrationVersion, setRegistrationVersion] = useState(0);
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[WEB_CHAT_BROWSER_TAB_ID];
      return {
        cornerRadius: current?.cornerRadius ?? 0,
        rect: resolveBrowserSurfacePanelRect(state.byTabId, WEB_CHAT_BROWSER_TAB_ID),
        visible: current?.visible ?? false,
      };
    }),
  );

  desiredUrlRef.current = getWebChatProviderDefinition(provider).url;

  useEffect(() => {
    const lease = acquireDesktopTab(WEB_CHAT_BROWSER_TAB_ID);
    tabLeaseRef.current = lease;
    return () => {
      if (tabLeaseRef.current === lease) tabLeaseRef.current = null;
      lease.release();
    };
  }, []);

  useEffect(() => {
    const lease = tabLeaseRef.current;
    const bridge = previewBridge;
    if (!lease || !bridge) return;
    let disposed = false;
    void (async () => {
      try {
        await lease.ready;
        if (disposed) return;
        await bridge.setDownloadDirectory(WEB_CHAT_BROWSER_TAB_ID, downloadDirectory);
      } catch {
        // A missing or host-inaccessible project path intentionally falls back
        // to Electron's standard download location.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [downloadDirectory]);

  useEffect(() => {
    const bridge = previewBridge;
    if (!bridge) return;
    const unsubscribe = bridge.onStateChange((tabId, navigation) => {
      if (tabId === WEB_CHAT_BROWSER_TAB_ID) {
        useWebChatBrowserStore.getState().setNavigation(navigation);
      }
    });
    return () => {
      unsubscribe();
      useWebChatBrowserStore.getState().setNavigation(null);
    };
  }, []);

  const setWebviewRef = useCallback((node: HTMLElement | null) => {
    webviewRef.current = node as HTMLElementTagNameMap["webview"] | null;
    if (node && !node.hasAttribute("allowpopups")) node.setAttribute("allowpopups", "true");
  }, []);

  useEffect(() => {
    lastNavigatedUrlRef.current = null;
  }, [config?.partition]);

  useEffect(() => {
    const webview = webviewRef.current;
    const lease = tabLeaseRef.current;
    const bridge = previewBridge;
    if (!webview || !lease || !bridge || !config) return;
    let disposed = false;

    const register = () => {
      void (async () => {
        try {
          await lease.ready;
          if (disposed || webviewRef.current !== webview) return;
          const webContentsId = webview.getWebContentsId();
          if (!Number.isInteger(webContentsId) || webContentsId <= 0) return;
          await bridge.registerWebview(WEB_CHAT_BROWSER_TAB_ID, webContentsId);
          if (disposed || webviewRef.current !== webview) return;
          setRegistrationVersion((version) => version + 1);
        } catch {
          // did-attach/dom-ready retries cover a guest that was not ready yet.
        }
      })();
    };

    webview.addEventListener("did-attach", register);
    webview.addEventListener("dom-ready", register);
    register();
    return () => {
      disposed = true;
      webview.removeEventListener("did-attach", register);
      webview.removeEventListener("dom-ready", register);
    };
  }, [config]);

  useEffect(() => {
    const bridge = previewBridge;
    if (!bridge || registrationVersion === 0) return;
    const desiredUrl = desiredUrlRef.current;
    if (lastNavigatedUrlRef.current === desiredUrl) return;
    lastNavigatedUrlRef.current = desiredUrl;
    void bridge.navigate(WEB_CHAT_BROWSER_TAB_ID, desiredUrl).catch(() => {
      if (lastNavigatedUrlRef.current === desiredUrl) lastNavigatedUrlRef.current = null;
    });
  }, [provider, registrationVersion]);

  if (!config) return null;

  const active = presentation.visible && presentation.rect !== null;
  const wrapperStyle = resolveHostedBrowserWebviewWrapperStyle({
    active,
    cornerRadius: presentation.cornerRadius,
    rect: presentation.rect,
    hiddenSize: HIDDEN_WEB_CHAT_SIZE,
  });

  return (
    <div
      className="fixed overflow-hidden bg-background"
      style={wrapperStyle}
      data-web-chat-browser-host=""
    >
      <webview
        key={config.partition}
        ref={setWebviewRef}
        src="about:blank"
        partition={config.partition}
        webpreferences={config.webPreferences}
        data-web-chat-browser=""
        aria-hidden={active ? undefined : true}
        className="flex size-full overflow-hidden bg-background"
      />
    </div>
  );
}
