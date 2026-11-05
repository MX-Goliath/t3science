export const crashReportingAvailable = false;

export function reportCrashError(error: unknown) {
  console.warn("[diagnostics] app error", error);
}

export async function setCrashReportsEnabled(_enabled: boolean) {}
