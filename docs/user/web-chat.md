# Web chat

The desktop and mobile apps can open ChatGPT, Claude, Grok, or Perplexity alongside your T3 Science threads.
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

On mobile, open **Settings → Web chat**, or choose **Web chat** in the command palette.
Select the provider from the page's menu. Sign-in cookies stay on the phone; **Open in browser**
opens the current page in your system browser. Leaving the screen closes its embedded page.

These provider sites do not support the iframe embedding that a regular web client would require.
On desktop, authentication is stored in a browser partition on the current device and is separate
from project Preview sessions.
