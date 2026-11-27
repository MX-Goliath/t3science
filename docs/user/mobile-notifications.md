# Mobile notifications

On Android, enable **Background notifications** in **Settings → Notifications → Direct notifications** to receive completion, failure, approval and input alerts directly from your paired servers. This mode needs no T3 Connect account, Firebase or Google Play services. It uses enabled bearer-authenticated connections, including LAN, Tailscale and tunnels. Tap an alert to open its thread; alerts for the thread currently on screen stay quiet.

Android keeps a persistent connection notification visible while this mode is enabled. The settings page shows connection counts and errors. For delivery while the phone sleeps, open **Battery settings** and allow unrestricted battery use for T3 Science. Device power management can still delay delivery. Monitoring resumes after a reboot when Android allows it. Reopen the app after a force-stop or if device power management prevents automatic startup. Turn off **Background notifications** to stop the service and remove its saved credentials and notifications. This mode requires an Android build that includes the background service. While it monitors an environment, cloud alerts for that environment are suppressed to avoid duplicates.

On Android 16 and newer, background monitoring can also appear as a status bar Live Update: **Online** when connected, **Working** during a task, **Approve** for approvals and **Answer** for questions. With several agents, requests take priority. Tap it to open the relevant thread. Enable or disable promotion through **Settings → Notifications → Live Update Settings**; availability depends on your Android version and device. Older Android versions show the same status in the persistent notification.

For cloud delivery on Android and iOS, use T3 Connect:

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

## Prerequisites

- Sign in to **T3 Connect** on both your phone and host machine (direct/Tailscale connections alone do not deliver background push notifications).
- Enable **Publish agent activity** in **Settings → Sharing & access** on the host.
- Enable **Device Notifications** in **Settings → Notifications** on mobile (Android requires Android 7.0+ and Google Play services).

## Live updates and widgets

- **Live progress**: Enable **Live Activity Updates** (iOS), **Agent Live Updates** (Android 16+, check **Live Update Settings** if missing), or **Ongoing Agent Activity** (older Android). Finished results stay visible for up to 15 minutes.
- **Silent live updates (Android 8+)**: Keep **Ongoing agent activity** on and disable **Agent alerts** in Android system notification settings.
- **iOS widget**: Add the **Agent Activity** widget to your Home Screen or Lock Screen (refreshes when you open T3; marks unfinished work stale after 10 minutes).

Cloud notifications on Android require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. If Live Updates don't appear on Android 16 or newer, check **Live Update Settings** in T3 Code's **Settings → Notifications**. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Cloud delivery does not need the mobile app to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents notification delivery until you open it again.
