# Desktop tray and startup

The Windows and Linux desktop apps can keep T3 Science running in the system tray. This keeps local
agents, remote connections, and the desktop backend available while the main window is hidden.

Open **Settings → General → Desktop app** to configure:

- **Keep running in the system tray** hides the window when you close it. Choose **Quit** from the
  tray menu when you want to stop the desktop app and its local backend.
- **Start in the system tray** starts the app without opening its main window. Select the tray icon
  to open it.
- **Launch at login** starts the installed desktop app when you sign in. Combine it with **Start in
  the system tray** for a quiet background launch.

On Linux, launch-at-login uses the standard XDG autostart directory. The tray icon uses the desktop
environment's StatusNotifier support and works natively in KDE Plasma.

These options affect only the desktop app on the current computer. They do not change web or mobile
clients, and they are separate from the headless Linux background service.

## Desktop notifications

In **Settings → General → Thread notifications**, choose **Notifications only** or
**Notifications with sound** to receive system alerts when a thread finishes, fails, or needs
input or approval. Alerts appear while the app is in the background, including when its window
is hidden in the system tray. System alerts and their sounds are suppressed while the window is
active. Each alert includes the thread title, its status, and a short preview of the model's
answer, question, requested action, or error. Select an alert to open its thread.

Linux builds, including AppImage, use native desktop notifications supported by KDE Plasma.
The system needs libnotify installed. Allow the app in **System Settings → Notifications** if
Plasma blocks its alerts. Choose **Off** in T3 Science to disable system alerts and sounds.
The desktop app must remain running, and connected to any remote environments you want alerts from.
