# Web chat

The desktop app can keep ChatGPT, Claude, Grok, or Perplexity open beside your T3 Code threads.
This is useful for web-only provider features such as deep research without running that work through
a provider CLI.

Open **Settings → General**, turn on **Web chat**, and choose **Web chat provider**. The provider,
with its logo, then appears directly below Search in both the default and legacy thread sidebars.

The page stays loaded when you switch between it, projects, threads, and settings. Its sign-in and
in-progress work therefore remain intact. Changing the provider setting navigates that persistent
browser session to the newly selected site.

When a provider asks where to save a download, the desktop dialog starts in the most recently
visited local project's root folder. If that folder is unavailable to the desktop host, the dialog
uses the operating system's standard download location instead.

Web chat is desktop-only. These provider sites do not support the iframe embedding that a regular web
client would require. Authentication is stored in a desktop browser partition on the current device
and is separate from project Preview sessions.
