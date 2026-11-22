import { assert, describe, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Observe the statfs adapter absent from Effect FileSystem.
import * as NodeFSP from "node:fs/promises";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/process";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";
import * as SystemResources from "./SystemResources.ts";

vi.mock("node:fs/promises", { spy: true });

function host(options: {
  platform?: NodeJS.Platform;
  files?: Record<string, string>;
  directories?: Record<string, Array<string>>;
  nvidia?: string;
  readStat?: () => string;
}) {
  return SystemResources.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          readFileString: (path) =>
            Effect.succeed(
              path === "/proc/stat" && options.readStat
                ? options.readStat()
                : (options.files?.[path] ?? ""),
            ),
          readDirectory: (path) => Effect.succeed(options.directories?.[path] ?? []),
        }),
        Layer.succeed(HostProcess.Platform, options.platform ?? "linux"),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
          ...ChildProcessSpawner.make(() => Effect.die("unexpected spawn")),
          string: () =>
            options.nvidia === undefined
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "NotFound",
                    module: "ChildProcess",
                    method: "string",
                  }),
                )
              : Effect.succeed(options.nvidia),
        }),
      ),
    ),
  );
}

describe("SystemResources", () => {
  it.effect("samples CPU deltas on demand and retains no periodic collector", () => {
    let reads = 0;
    return Effect.gen(function* () {
      const resources = yield* SystemResources.SystemResources;
      const initial = yield* resources.read;
      assert.strictEqual(initial.cpu.utilization, null);
      assert.deepStrictEqual(initial.gpus, []);
      yield* TestClock.adjust("10 seconds");
      assert.strictEqual(reads, 1);
      const reopened = yield* resources.read;
      assert.strictEqual(reopened.cpu.utilization, null);
      yield* TestClock.adjust("2 seconds");
      const next = yield* resources.read;
      assert.strictEqual(next.cpu.utilization, 0.75);
      assert.strictEqual(next.cpu.coreCount, 2);
      assert.strictEqual(next.cpu.frequencyMhz, 3000);
      assert.deepStrictEqual(next.memory, { totalBytes: 4096 * 1024, usedBytes: 3072 * 1024 });
    }).pipe(
      Effect.provide(
        host({
          directories: { "/proc/driver/nvidia/gpus": ["0000:01:00.0"] },
          readStat: () => {
            const sample = reads++;
            return `cpu ${100 + sample * 75} 0 0 ${100 + sample * 25} 0 0 0 0\n`;
          },
          files: {
            "/proc/cpuinfo": "processor: 0\ncpu MHz: 2800\nprocessor: 1\ncpu MHz: 3200\n",
            "/proc/meminfo": "MemTotal: 4096 kB\nMemAvailable: 1024 kB\n",
          },
        }),
      ),
    );
  });

  it.effect(
    "includes mounted local disks, unescapes paths and drops network, virtual and duplicate mounts",
    () =>
      Effect.gen(function* () {
        using statfs = vi.spyOn(NodeFSP, "statfs").mockImplementation(async () => ({
          type: 0,
          bsize: 4096,
          blocks: 1000,
          bfree: 400,
          bavail: 300,
          files: 0,
          ffree: 0,
        }));
        const resources = yield* SystemResources.SystemResources;
        const snapshot = yield* resources.read;
        assert.deepStrictEqual(
          snapshot.disks.map((disk) => disk.mountPath),
          ["/", "/media/Mac", "/media/My disk"],
        );
        assert.strictEqual(snapshot.disks[1]?.usedBytes, 600 * 4096);
        assert.strictEqual(snapshot.disks[1]?.totalBytes, 1000 * 4096);
        assert.strictEqual(statfs.mock.calls.length, 3);
      }).pipe(
        Effect.provide(
          host({
            files: {
              "/proc/self/mountinfo": [
                "1 0 8:1 / / rw - ext4 /dev/sda1 rw",
                "2 0 8:1 /home /mnt/duplicate rw - ext4 /dev/sda1 rw",
                "3 0 8:2 / /media/My\\040disk rw - exfat /dev/sdb1 rw",
                "4 0 0:1 / /net rw - nfs server:/share rw",
                "5 0 0:2 / /run rw - tmpfs tmpfs rw",
                "6 0 8:3 / /media/Mac rw - hfsplus /dev/sdc1 rw",
              ].join("\n"),
            },
          }),
        ),
      ),
  );

  it.effect("reports AMD and NVIDIA separately and preserves unavailable readings", () =>
    Effect.gen(function* () {
      const resources = yield* SystemResources.SystemResources;
      const snapshot = yield* resources.read;
      assert.deepStrictEqual(
        snapshot.gpus.map((gpu) => [gpu.id, gpu.utilization, gpu.temperatureCelsius]),
        [
          ["amd:0000:03:00.0", 0.42, 61],
          ["nvidia:GPU-123", 0.25, null],
        ],
      );
      assert.strictEqual(snapshot.gpus[0]?.name, "AMD Radeon RX 7900 XTX");
      assert.strictEqual(snapshot.gpus[1]?.memoryUsedBytes, 128 * 1024 ** 2);
      assert.strictEqual(snapshot.gpus[0]?.memoryTotalBytes, null);
    }).pipe(
      Effect.provide(
        host({
          directories: {
            "/sys/class/drm": ["card0", "card0-DP-1"],
            "/proc/driver/nvidia/gpus": ["0000:01:00.0"],
            "/sys/class/drm/card0/device/hwmon": ["hwmon4"],
          },
          files: {
            "/sys/class/drm/card0/device/vendor": "0x1002\n",
            "/sys/class/drm/card0/device/uevent": "PCI_SLOT_NAME=0000:03:00.0\n",
            "/sys/class/drm/card0/device/device": "0x744c\n",
            "/sys/class/drm/card0/device/revision": "0xc8\n",
            "/usr/share/libdrm/amdgpu.ids": "744C, C8, AMD Radeon RX 7900 XTX\n",
            "/sys/class/drm/card0/device/gpu_busy_percent": "42\n",
            "/sys/class/drm/card0/device/hwmon/hwmon4/temp1_input": "61000\n",
          },
          nvidia: "GPU-123, NVIDIA RTX, 25, [N/A], 128, 8192\n",
        }),
      ),
    ),
  );

  it.effect("returns an unsupported snapshot without Linux or driver I/O on other hosts", () =>
    Effect.gen(function* () {
      const resources = yield* SystemResources.SystemResources;
      const snapshot = yield* resources.read;
      assert.strictEqual(snapshot.supported, false);
      assert.deepStrictEqual(snapshot.disks, []);
      assert.deepStrictEqual(snapshot.gpus, []);
    }).pipe(Effect.provide(host({ platform: "darwin" }))),
  );
});
