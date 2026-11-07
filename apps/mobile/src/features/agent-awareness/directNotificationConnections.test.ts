import { describe, expect, it } from "vite-plus/test";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  RelayConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { directNotificationRoutes } from "./directNotificationConnections";

const environmentId = EnvironmentId.make("server");
function entry(): ConnectionCatalogEntry {
  return {
    enabled: true,
    target: new BearerConnectionTarget({
      environmentId,
      label: "My server",
      connectionId: "saved",
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId,
        label: "My server",
        connectionId: "saved",
        httpBaseUrl: "http://100.64.0.1:3000",
        wsBaseUrl: "ws://100.64.0.1:3000",
      }),
    ),
  };
}

describe("direct notification connections", () => {
  it("selects saved direct connections and excludes disabled, unsupported and cloud-authorized routes", () => {
    const direct = entry();
    expect(directNotificationRoutes([direct])).toEqual([
      {
        environmentId,
        label: "My server",
        connectionId: "saved",
        httpBaseUrl: "http://100.64.0.1:3000",
        wsBaseUrl: "ws://100.64.0.1:3000",
      },
    ]);
    const profile = Option.getOrThrow(direct.profile);
    if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected a bearer profile");
    expect(
      directNotificationRoutes([
        { ...direct, enabled: false },
        { ...direct, unsupportedReason: "unsupported" },
        { ...direct, profile: Option.none() },
        {
          ...direct,
          profile: Option.some(
            new BearerConnectionProfile({ ...profile, authorization: "t3-connect" }),
          ),
        },
        {
          ...direct,
          profile: Option.some(
            new BearerConnectionProfile({ ...profile, environmentId: EnvironmentId.make("other") }),
          ),
        },
      ]),
    ).toEqual([]);
  });

  it("uses a paired alternate route for a relay environment without requiring its cloud credentials", () => {
    const direct = entry();
    const relay = new RelayConnectionTarget({ environmentId, label: "My server" });
    expect(
      directNotificationRoutes([{ ...direct, target: relay, profile: Option.none() }]),
    ).toEqual([]);
    expect(
      directNotificationRoutes([
        { ...direct, target: relay, profile: Option.none(), alternateRoutes: [direct] },
      ]),
    ).toHaveLength(1);
  });
});
