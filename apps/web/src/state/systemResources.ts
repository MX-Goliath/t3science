import type { EnvironmentId, SystemResourcesSnapshot } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "./server";

const HISTORY_WINDOW_MS = 60_000;

interface SystemResourceHistory {
  readonly snapshot: SystemResourcesSnapshot | null;
  readonly history: ReadonlyArray<SystemResourcesSnapshot>;
  readonly failed: boolean;
  readonly pending: boolean;
}

const cachedSystemResourceHistoryAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make<ReadonlyArray<SystemResourcesSnapshot>>([]).pipe(
    Atom.setIdleTTL(HISTORY_WINDOW_MS),
    Atom.withLabel(`cached-system-resource-history:${environmentId}`),
  ),
);

export const systemResourceHistoryAtom = Atom.family((environmentId: EnvironmentId) => {
  const cachedHistory = cachedSystemResourceHistoryAtom(environmentId);
  return Atom.make((get): SystemResourceHistory => {
    const query = serverEnvironment.systemResources({ environmentId, input: {} });
    const result = get(query);
    // Keep samples through panel remounts without keeping the polling query alive.
    get.mount(cachedHistory);
    let history = get.once(cachedHistory);
    const latest = history.at(-1);
    const snapshot = result._tag === "Success" ? result.value : null;
    if (snapshot !== null && snapshot.sampledAt !== latest?.sampledAt) {
      history = [
        ...history.filter((sample) => sample.sampledAt >= snapshot.sampledAt - HISTORY_WINDOW_MS),
        snapshot,
      ].slice(-31);
      get.set(cachedHistory, history);
    }
    // A slow RPC must finish before its next poll can refresh and interrupt it.
    if (result._tag !== "Initial" && !result.waiting) {
      const timer = setTimeout(() => get.refresh(query), 2_000);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return {
      snapshot: result._tag === "Initial" ? (latest ?? null) : snapshot,
      history,
      failed: result._tag === "Failure",
      pending: result._tag === "Initial" || result.waiting,
    };
  }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`system-resource-history:${environmentId}`));
});
