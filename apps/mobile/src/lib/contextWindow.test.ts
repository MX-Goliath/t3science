import { describe, expect, it } from "vite-plus/test";
import { formatCompactTokens } from "./contextWindow";
describe("mobile context display", () => {
  it.each([
    [60000, "60k"],
    [1500, "1.5k"],
    [42, "42"],
    [2000000, "2m"],
  ])("formats %s tokens as %s", (tokens, label) => {
    expect(formatCompactTokens(Number(tokens))).toBe(label);
  });
});
