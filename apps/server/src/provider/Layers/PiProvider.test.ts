import * as NodeServices from "@effect/platform-node/NodeServices";
import { PiSettings } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  buildInitialPiProviderSnapshot,
  checkPiProviderStatus,
  piModelCapabilities,
} from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

describe("buildInitialPiProviderSnapshot", () => {
  it.effect("keeps Pi disabled without claiming the binary is installed", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({ enabled: false }));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.models).toEqual([]);
    }),
  );

  it.effect("does not invent a fallback model before RPC discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({}));
      expect(snapshot.status).toBe("warning");
      expect(snapshot.models).toEqual([]);
      expect(snapshot.requiresNewThreadForModelChange).toBe(false);
    }),
  );
});

describe("piModelCapabilities", () => {
  it("exposes only the thinking levels reported by Pi for that model", () => {
    expect(piModelCapabilities(["off", "high", "max"]).optionDescriptors).toEqual([
      {
        id: "thinkingLevel",
        label: "Thinking",
        description: "Pi reasoning level supported by this model.",
        type: "select",
        options: [
          { id: "off", label: "Off" },
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ],
      },
    ]);
  });
});

it.layer(NodeServices.layer)("checkPiProviderStatus", (it) => {
  it.effect("checks the configured binary path", () =>
    Effect.gen(function* () {
      const binaryPath = "/definitely/not/installed/custom-pi";
      const snapshot = yield* checkPiProviderStatus(
        decodePiSettings({ enabled: true, binaryPath }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain(binaryPath);
    }),
  );
});
