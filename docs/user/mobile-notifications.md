# Mobile notifications

On Android, enable **Background notifications** in **Settings → Notifications → Direct notifications** to receive completion, failure, approval and input alerts directly from your paired servers. This mode needs no T3 Connect account, Firebase or Google Play services. It uses enabled bearer-authenticated connections, including LAN, Tailscale and tunnels. Tap an alert to open its thread; alerts for the thread currently on screen stay quiet.

Android keeps a persistent connection notification visible while this mode is enabled. The settings page shows connection counts and errors. For delivery while the phone sleeps, open **Battery settings** and allow unrestricted battery use for T3 Science. Device power management can still delay delivery. Monitoring resumes after a reboot when Android allows it. Reopen the app after a force-stop or if device power management prevents automatic startup. Turn off **Background notifications** to stop the service and remove its saved credentials and notifications. This mode requires an Android build that includes the background service. While it monitors an environment, cloud alerts for that environment are suppressed to avoid duplicates.

On Android 16 and newer, background monitoring can also appear as a status bar Live Update: **Online** when connected, **Working** during a task, **Approve** for approvals and **Answer** for questions. With several agents, requests take priority. Tap it to open the relevant thread. Enable or disable promotion through **Settings → Notifications → Live Update Settings**; availability depends on your Android version and device. Older Android versions show the same status in the persistent notification.

For cloud delivery on Android and iOS, use T3 Connect:

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

Enable **Live Activity Updates** on iOS, **Agent Live Updates** on Android 16 and newer, or **Ongoing Agent Activity** on older Android versions to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off the same switch to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

Cloud notifications on Android require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. If Live Updates don't appear on Android 16 or newer, check **Live Update Settings** in T3 Code's **Settings → Notifications**. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Cloud delivery does not need the mobile app to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents notification delivery until you open it again.
