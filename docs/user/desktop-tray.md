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
