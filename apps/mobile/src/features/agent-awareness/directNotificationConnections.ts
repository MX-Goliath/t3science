import type { ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";

export function directNotificationRoutes(entries: Iterable<ConnectionCatalogEntry>) {
  return [...entries].flatMap((entry) => {
    if (!entry.enabled || entry.unsupportedReason !== undefined) return [];
    for (const route of [entry, ...(entry.alternateRoutes ?? [])]) {
      if (route.target._tag !== "BearerConnectionTarget" || Option.isNone(route.profile)) continue;
      const profile = route.profile.value;
      if (profile._tag !== "BearerConnectionProfile" || profile.authorization === "t3-connect")
        continue;
      if (profile.environmentId !== entry.target.environmentId) continue;
      return [
        {
          environmentId: entry.target.environmentId,
          label: entry.target.label,
          connectionId: route.target.connectionId,
          httpBaseUrl: profile.httpBaseUrl,
          wsBaseUrl: profile.wsBaseUrl,
        },
      ];
    }
    return [];
  });
}
