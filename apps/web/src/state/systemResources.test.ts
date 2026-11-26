import { EnvironmentId, type SystemResourcesSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { serverEnvironment } from "./server";
import { systemResourceHistoryAtom } from "./systemResources";

vi.mock("./server", () => ({ serverEnvironment: { systemResources: vi.fn() } }));

function snapshot(sampledAt: number): SystemResourcesSnapshot {
  return {
    supported: true,
    sampledAt,
    cpu: { utilization: 0.25, coreCount: 8, frequencyMhz: null, temperatureCelsius: null },
    memory: { usedBytes: 128, totalBytes: 1024 },
    disks: [],
    gpus: [],
  };
}

function setup() {
  vi.useFakeTimers();
  const scheduled: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.push(task);
      return () => {};
    },
  });
  const flush = () => {
    for (const task of scheduled.splice(0)) task();
  };
  const query = vi.mocked(serverEnvironment.systemResources).mockReset();
  const history = systemResourceHistoryAtom(EnvironmentId.make("resources-test"));
  return {
    registry,
    history,
    query,
    flush,
    [Symbol.dispose]() {
      registry.dispose();
      vi.useRealTimers();
    },
  };
}

it("stops polling with the last reader and keeps recent samples separate per environment", () => {
  using fixture = setup();
  const { registry, history, query, flush } = fixture;
  let reads = 0;
  let cancelled = 0;
  const resourceQuery = Atom.make((get) => {
    reads++;
    if (reads === 3) {
      get.addFinalizer(() => cancelled++);
      return AsyncResult.initial<SystemResourcesSnapshot, Error>();
    }
    if (reads === 4) return AsyncResult.initial<SystemResourcesSnapshot, Error>();
    return AsyncResult.success(snapshot(reads * 2_000));
  }).pipe(Atom.setIdleTTL(0));
  const otherEnvironment = EnvironmentId.make("other-resources-test");
  const otherHistory = systemResourceHistoryAtom(otherEnvironment);
  const otherQuery = Atom.make(AsyncResult.success(snapshot(16_000))).pipe(Atom.setIdleTTL(0));
  query.mockImplementation(({ environmentId }) =>
    environmentId === otherEnvironment ? otherQuery : resourceQuery,
  );

  expect(reads).toBe(0);
  const releaseFirst = registry.mount(history);
  const releaseSecond = registry.mount(history);
  expect(reads).toBe(1);
  vi.advanceTimersByTime(2_000);
  expect(reads).toBe(2);
  releaseFirst();
  flush();
  vi.advanceTimersByTime(2_000);
  expect(reads).toBe(3);
  vi.advanceTimersByTime(10_000);
  expect(reads).toBe(3);
  expect(cancelled).toBe(0);
  releaseSecond();
  flush();
  expect(cancelled).toBe(1);
  const releaseOther = registry.mount(otherHistory);
  expect(registry.get(otherHistory).history.map((sample) => sample.sampledAt)).toEqual([16_000]);
  vi.advanceTimersByTime(10_000);
  expect(reads).toBe(3);
  releaseOther();
  flush();

  const releaseReturning = registry.mount(history);
  expect(reads).toBe(4);
  expect(registry.get(history)).toMatchObject({ snapshot: snapshot(4_000), pending: true });
  registry.refresh(resourceQuery);
  expect(registry.get(history).history.map((sample) => sample.sampledAt)).toEqual([
    2_000, 4_000, 10_000,
  ]);
  releaseReturning();
  flush();
  vi.advanceTimersByTime(62_000);
  expect(reads).toBe(5);

  const releaseAfterExpiry = registry.mount(history);
  expect(registry.get(history).history.map((sample) => sample.sampledAt)).toEqual([12_000]);
  releaseAfterExpiry();
});

it("keeps only the last minute and 31 unique samples and exposes failures without a stale snapshot", () => {
  using fixture = setup();
  const { registry, history, query } = fixture;
  const resourceQuery = Atom.make<AsyncResult.AsyncResult<SystemResourcesSnapshot, Error>>(
    AsyncResult.success(snapshot(0)),
  );
  query.mockReturnValue(resourceQuery);
  const release = registry.mount(history);
  try {
    for (let index = 1; index <= 70; index++) {
      registry.set(resourceQuery, AsyncResult.success(snapshot(index * 1_000)));
      registry.get(history);
    }
    expect(registry.get(history).history).toHaveLength(31);
    expect(registry.get(history).history[0]?.sampledAt).toBe(40_000);
    registry.set(resourceQuery, AsyncResult.success(snapshot(70_000)));
    expect(registry.get(history).history).toHaveLength(31);
    registry.set(resourceQuery, AsyncResult.success(snapshot(200_000)));
    expect(registry.get(history).history.map((sample) => sample.sampledAt)).toEqual([200_000]);

    registry.set(resourceQuery, AsyncResult.failure(Cause.fail(new Error("disconnected"))));
    expect(registry.get(history)).toMatchObject({ snapshot: null, failed: true, pending: false });
    expect(registry.get(history).history).toHaveLength(1);
  } finally {
    release();
  }
});
