import type { DesktopPreviewTabState } from "@t3tools/contracts";
import { create } from "zustand";

interface WebChatBrowserState {
  readonly navigation: DesktopPreviewTabState | null;
  readonly setNavigation: (navigation: DesktopPreviewTabState | null) => void;
}

export const useWebChatBrowserStore = create<WebChatBrowserState>()((set) => ({
  navigation: null,
  setNavigation: (navigation) => set({ navigation }),
}));
