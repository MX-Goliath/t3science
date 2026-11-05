import { expect, it, vi } from "vite-plus/test";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: "configured-project" },
        relay: { url: "https://relay.example.com" },
      },
    },
  },
}));

it("keeps crash reporting unavailable even with cloud configuration", async () => {
  const reporting = await import("./observe");
  expect(reporting.crashReportingAvailable).toBe(false);
  await reporting.setCrashReportsEnabled(true);
  expect(reporting.crashReportingAvailable).toBe(false);
});
