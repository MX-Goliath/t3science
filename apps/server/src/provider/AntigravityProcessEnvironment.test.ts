import { describe, expect, it } from "vite-plus/test";

import { makeAntigravityProcessEnvironment } from "./AntigravityProcessEnvironment.ts";

describe("makeAntigravityProcessEnvironment", () => {
  it("does not identify agy as the Electron desktop app", () => {
    expect(
      makeAntigravityProcessEnvironment(undefined, {
        CHROME_DESKTOP: "t3science.desktop",
        PATH: "/bin",
      }),
    ).toEqual({ PATH: "/bin" });
  });

  it("allows an explicitly configured desktop marker", () => {
    expect(
      makeAntigravityProcessEnvironment(
        [{ name: "CHROME_DESKTOP", value: "custom.desktop", sensitive: false }],
        { CHROME_DESKTOP: "t3science.desktop", PATH: "/bin" },
      ),
    ).toEqual({ CHROME_DESKTOP: "custom.desktop", PATH: "/bin" });
  });
});
