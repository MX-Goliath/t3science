import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { WEB_CHAT_PROVIDERS, getWebChatProviderDefinition } from "@t3tools/shared/webChat";
import type { WebChatProvider } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { useHardwareBack } from "../../lib/backHandler";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export function WebChatRouteScreen() {
  const navigation = useNavigation();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const updatePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const provider =
    (AsyncResult.isSuccess(preferences) ? preferences.value.webChatProvider : undefined) ??
    "chatgpt";
  const definition = getWebChatProviderDefinition(provider);
  const webView = useRef<WebView<object>>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(definition.url as string);
  useHardwareBack(canGoBack, () => {
    webView.current?.goBack();
    return true;
  });
  const selectProvider = (next: WebChatProvider) => {
    setCanGoBack(false);
    setCurrentUrl(getWebChatProviderDefinition(next).url);
    void updatePreferences({ webChatProvider: next });
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={definition.label}
        subtitle="Web chat"
        onBack={() => navigation.goBack()}
        actions={[
          {
            accessibilityLabel: "Back in web chat",
            icon: "chevron.left",
            disabled: !canGoBack,
            onPress: () => webView.current?.goBack(),
          },
          {
            accessibilityLabel: "Reload web chat",
            icon: "arrow.clockwise",
            onPress: () => webView.current?.reload(),
          },
          {
            accessibilityLabel: "Open in browser",
            icon: "safari",
            onPress: () => void Linking.openURL(currentUrl),
          },
        ]}
        menus={[
          {
            title: "Chat provider",
            icon: "bubble.left.and.bubble.right",
            items: (Object.keys(WEB_CHAT_PROVIDERS) as WebChatProvider[]).map((entry) => ({
              id: entry,
              title: WEB_CHAT_PROVIDERS[entry].label,
              selected: entry === provider,
              onPress: () => selectProvider(entry),
            })),
          },
        ]}
      />
      <WebView<object>
        key={provider}
        ref={webView}
        source={{ uri: definition.url }}
        style={{ flex: 1 }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        onNavigationStateChange={(state) => {
          setCanGoBack(state.canGoBack);
          setCurrentUrl(state.url);
        }}
        renderError={() => (
          <View className="flex-1 items-center justify-center gap-3 bg-screen p-6">
            <Text className="text-center text-lg font-t3-medium">
              Could not load {definition.label}
            </Text>
            <Text className="text-center text-foreground-muted">
              Check your Internet connection, then reload or open the site in your browser.
            </Text>
          </View>
        )}
        onContentProcessDidTerminate={() => webView.current?.reload()}
      />
    </View>
  );
}
