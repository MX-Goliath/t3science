import { describe, expect, it } from "vite-plus/test";

import { containsMarkdownImage } from "./thread-feed-markdown";

describe("containsMarkdownImage", () => {
  it("detects inline and reference-style Markdown images", () => {
    expect(containsMarkdownImage("![Result](./result.png)")).toBe(true);
    expect(
      containsMarkdownImage("![Result][generated]\n\n[generated]: https://example.com/a.png"),
    ).toBe(true);
  });

  it("does not treat ordinary links as images", () => {
    expect(containsMarkdownImage("[Result](./result.png)")).toBe(false);
  });
});
