import type { EnvironmentId, SystemResourcesSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "./server";

interface SystemResourceHistory {
  readonly snapshot: SystemResourcesSnapshot | null;
  readonly history: ReadonlyArray<SystemResourcesSnapshot>;
  readonly failed: boolean;
  readonly pending: boolean;
}

export const systemResourceHistoryAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): SystemResourceHistory => {
    const query = serverEnvironment.systemResources({ environmentId, input: {} });
    const result = get(query);
    const previous = Option.getOrUndefined(get.self<SystemResourceHistory>());
    const snapshot = result._tag === "Success" ? result.value : null;
    const history = previous?.history ?? [];
    const nextHistory =
      snapshot === null || history.at(-1)?.sampledAt === snapshot.sampledAt
        ? history
        : [
            ...history.filter((sample) => sample.sampledAt >= snapshot.sampledAt - 60_000),
            snapshot,
          ].slice(-31);
    // A slow RPC must finish before its next poll can refresh and interrupt it.
    if (result._tag !== "Initial" && !result.waiting) {
      const timer = setTimeout(() => get.refresh(query), 2_000);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return {
      snapshot,
      history: nextHistory,
      failed: result._tag === "Failure",
      pending: result._tag === "Initial" || result.waiting,
    };
  }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`system-resource-history:${environmentId}`)),
);
