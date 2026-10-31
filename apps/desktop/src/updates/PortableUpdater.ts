import { NsisUpdater } from "electron-updater";

import { portableInstallScript } from "./portableInstall.ts";

export class PortableUpdater extends NsisUpdater {
  private readonly executable: string;
  private readonly powershell: string;

  constructor(executable: string, systemRoot = "C:\\Windows") {
    super({
      provider: "generic",
      url: "https://github.com/MX-Goliath/t3science/releases/latest/download/",
    });
    this.executable = executable;
    this.powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    this.disableDifferentialDownload = true;
  }

  protected override doInstall(options: { readonly isForceRunAfter: boolean }): boolean {
    const source = this.installerPath;
    if (!source) throw new Error("Portable update path is unavailable.");
    const script = portableInstallScript(source, this.executable, options.isForceRunAfter);
    void this.spawnLog(this.powershell, [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ]).catch((cause: unknown) =>
      this.dispatchError(cause instanceof Error ? cause : new Error(String(cause))),
    );
    return true;
  }
}
