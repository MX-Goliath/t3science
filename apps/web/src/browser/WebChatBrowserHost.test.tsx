import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {},
}));

vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: <T,>(
    select: (settings: { webChatEnabled: boolean; webChatProvider: "chatgpt" }) => T,
  ) => select({ webChatEnabled: true, webChatProvider: "chatgpt" }),
}));

vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => "local",
}));

vi.mock("~/state/entities", () => ({
  useProjects: () => [],
  useThreadShells: () => [],
}));

vi.mock("~/uiStateStore", () => ({
  useUiStateStore: <T,>(
    select: (state: { threadLastVisitedAtById: Record<string, string> }) => T,
  ) => select({ threadLastVisitedAtById: {} }),
}));

vi.mock("./previewWebviewConfigState", () => ({
  usePreviewWebviewConfig: () => null,
}));

import { WebChatBrowserHost } from "./WebChatBrowserHost";

describe("WebChatBrowserHost", () => {
  it("can mount outside RouterProvider when web chat is enabled", () => {
    expect(() => renderToStaticMarkup(<WebChatBrowserHost />)).not.toThrow();
  });
});
