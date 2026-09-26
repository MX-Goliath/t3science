import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { migrateLegacyResponseStreaming } from "./legacyResponseStreaming.ts";

const decode = (value: unknown) =>
  Schema.decodeUnknownSync(ServerSettings)(migrateLegacyResponseStreaming(value));
describe("legacy response streaming migration", () => {
  it("drops the old instance switch so selecting the new default survives reload", () => {
    const migrated = decode({
      responseStreamingMode: "paragraph",
      providerInstances: {
        work: { driver: "opencode", config: { enableLegacyTokenStreaming: true } },
      },
    });
    expect(migrated.providerInstances[ProviderInstanceId.make("work")]?.config).not.toHaveProperty(
      "enableLegacyTokenStreaming",
    );
    const { responseStreamingMode: _, ...sparse } = Schema.encodeSync(ServerSettings)(migrated);
    expect(decode(sparse).responseStreamingMode).toBe("paragraph");
  });
  it("keeps upstream defaults when no legacy choice was saved", () => {
    expect(decode({}).responseStreamingMode).toBe("paragraph");
  });
  it.each([true, false])("preserves a saved OpenCode streaming choice: %s", (choice) => {
    expect(
      decode({ providers: { opencode: { enableLegacyTokenStreaming: choice } } })
        .responseStreamingMode,
    ).toBe(choice ? "token" : "turn");
    expect(
      decode({
        providerInstances: {
          work: { driver: "opencode", config: { enableLegacyTokenStreaming: choice } },
        },
      }).responseStreamingMode,
    ).toBe(choice ? "token" : "turn");
  });
  it("preserves an explicit new setting across later loads", () => {
    expect(
      decode({ responseStreamingMode: "paragraph", enableLegacyTokenStreaming: true })
        .responseStreamingMode,
    ).toBe("paragraph");
  });
  it("retains an enabled provider choice when global streaming was disabled", () => {
    expect(
      decode({
        enableLegacyTokenStreaming: false,
        providers: { opencode: { enableLegacyTokenStreaming: true } },
      }).responseStreamingMode,
    ).toBe("token");
  });
});
