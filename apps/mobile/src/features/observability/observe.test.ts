import { expect, it, vi } from "vite-plus/test";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-observe", () => {
  throw new Error("Observe requires an Expo project ID");
});

it("starts without loading cloud crash reporting when no Expo project is configured", async () => {
  vi.stubGlobal("__DEV__", true);
  try {
    const reporting = await import("./observe");
    expect(reporting.crashReportingAvailable).toBe(false);
    await reporting.setCrashReportsEnabled(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
