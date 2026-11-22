import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect FileSystem has no statfs query.
import * as NodeFSP from "node:fs/promises";
import type { SystemResourcesSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class DiskReadError extends Schema.TaggedError<DiskReadError>()("DiskReadError", {
  mountPath: Schema.String,
  cause: Schema.Defect(),
}) {}

export class SystemResources extends Context.Service<
  SystemResources,
  { readonly read: Effect.Effect<SystemResourcesSnapshot> }
>()("t3/resourceTelemetry/SystemResources") {}

function number(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function cpuCounters(stat: string) {
  const fields = /^cpu\s+(.+)$/m.exec(stat)?.[1]?.trim().split(/\s+/).map(Number);
  if (!fields || fields.length < 4 || fields.some((value) => !Number.isFinite(value))) return null;
  return {
    total: fields.slice(0, 8).reduce((sum, value) => sum + value, 0),
    idle: (fields[3] ?? 0) + (fields[4] ?? 0),
  };
}

function mounts(text: string) {
  const devices = new Map<string, { id: string; label: string; mountPath: string }>();
  const unescape = (value: string) =>
    value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  for (const line of text.split("\n")) {
    const [mount, filesystem] = line.split(" - ");
    if (!mount || !filesystem) continue;
    const fields = mount.split(" ");
    const [type, rawSource] = filesystem.split(" ");
    if (!rawSource || !type || !fields[4] || !fields[2]) continue;
    const source = unescape(rawSource);
    if (!source.startsWith("/dev/") && type !== "zfs") continue;
    const mountPath = unescape(fields[4]);
    const device = `${fields[2]}:${source}`;
    const current = devices.get(device);
    if (!current || mountPath.length < current.mountPath.length) {
      devices.set(device, { id: mountPath, label: source, mountPath });
    }
  }
  return [...devices.values()].sort((a, b) => a.mountPath.localeCompare(b.mountPath));
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const readFile = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
  const directory = (path: string) => fs.readDirectory(path).pipe(Effect.orElseSucceed(() => []));
  let previousCpu: ReturnType<typeof cpuCounters> = null;
  let previousCpuAt: number | null = null;
  let amdNames: string | undefined;

  const temperature = Effect.fn("SystemResources.temperature")(function* (path: string) {
    const entries = yield* directory(path);
    for (const entry of entries) {
      const value = number(yield* readFile(`${path}/${entry}/temp1_input`));
      if (value !== null) return value / 1000;
    }
    return null;
  });

  const readGpus = Effect.fn("SystemResources.readGpus")(function* () {
    const gpus: Array<SystemResourcesSnapshot["gpus"][number]> = [];
    const cards = yield* directory("/sys/class/drm");
    let hasNvidia = (yield* directory("/proc/driver/nvidia/gpus")).length > 0;
    for (const card of cards.filter((name) => /^card\d+$/.test(name))) {
      const path = `/sys/class/drm/${card}/device`;
      const vendor = (yield* readFile(`${path}/vendor`)).trim();
      if (vendor === "0x10de") hasNvidia = true;
      if (vendor !== "0x1002") continue;
      const slot = /^PCI_SLOT_NAME=(.+)$/m.exec(yield* readFile(`${path}/uevent`))?.[1] ?? card;
      const busy = number(yield* readFile(`${path}/gpu_busy_percent`));
      let name = (yield* readFile(`${path}/product_name`)).trim();
      if (!name) {
        amdNames ??= yield* readFile("/usr/share/libdrm/amdgpu.ids");
        const device = (yield* readFile(`${path}/device`)).trim().replace(/^0x/, "").toUpperCase();
        const revision = (yield* readFile(`${path}/revision`))
          .trim()
          .replace(/^0x/, "")
          .toUpperCase();
        name =
          amdNames
            .split("\n")
            .map((line) => line.split(",").map((field) => field.trim()))
            .find(([id, rev]) => id === device && rev === revision)?.[2] ?? "";
      }

      gpus.push({
        id: `amd:${slot}`,
        name: name || `AMD ${slot}`,
        vendor: "amd",
        utilization: busy === null ? null : Math.min(1, busy / 100),
        temperatureCelsius: yield* temperature(`${path}/hwmon`),
        memoryUsedBytes: number(yield* readFile(`${path}/mem_info_vram_used`)),
        memoryTotalBytes: number(yield* readFile(`${path}/mem_info_vram_total`)),
      });
    }
    if (!hasNvidia) return gpus;
    const nvidia = yield* spawner
      .string(
        ChildProcess.make(
          "nvidia-smi",
          [
            "--query-gpu=uuid,name,utilization.gpu,temperature.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
          ],
          { stdin: "ignore", stderr: "ignore" },
        ),
      )
      .pipe(
        Effect.timeout("1 second"),
        Effect.orElseSucceed(() => ""),
      );
    for (const line of nvidia.trim().split("\n")) {
      const [uuid, name, utilization, temp, used, total] = line
        .split(",")
        .map((value) => value.trim());
      if (!uuid?.startsWith("GPU-") || !name) continue;
      const busy = number(utilization ?? "");
      const memoryUsed = number(used ?? "");
      const memoryTotal = number(total ?? "");
      gpus.push({
        id: `nvidia:${uuid}`,
        name,
        vendor: "nvidia",
        utilization: busy === null ? null : Math.min(1, busy / 100),
        temperatureCelsius: number(temp ?? ""),
        memoryUsedBytes: memoryUsed === null ? null : Math.round(memoryUsed * 1024 ** 2),
        memoryTotalBytes: memoryTotal === null ? null : Math.round(memoryTotal * 1024 ** 2),
      });
    }
    return gpus;
  });

  const sample = Effect.fn("SystemResources.sample")(function* () {
    const sampledAt = yield* Clock.currentTimeMillis;
    if (platform !== "linux")
      return {
        supported: false,
        sampledAt,
        cpu: { utilization: null, coreCount: 0, frequencyMhz: null, temperatureCelsius: null },
        memory: { usedBytes: 0, totalBytes: 0 },
        disks: [],
        gpus: [],
      } satisfies SystemResourcesSnapshot;

    const cpu = cpuCounters(yield* readFile("/proc/stat"));
    const delta = cpu && previousCpu ? cpu.total - previousCpu.total : 0;
    const idleDelta = cpu && previousCpu ? cpu.idle - previousCpu.idle : 0;
    const utilization =
      previousCpuAt !== null && sampledAt - previousCpuAt <= 5000 && delta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / delta))
        : null;
    previousCpu = cpu;
    previousCpuAt = sampledAt;
    const cpuinfo = yield* readFile("/proc/cpuinfo");
    const frequencies = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((match) =>
      Number(match[1]),
    );
    const meminfo = yield* readFile("/proc/meminfo");
    const totalBytes = Number(/^MemTotal:\s+(\d+)/m.exec(meminfo)?.[1] ?? 0) * 1024;
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1] ?? 0) * 1024;
    let cpuTemperature: number | null = null;
    for (const entry of yield* directory("/sys/class/hwmon")) {
      const path = `/sys/class/hwmon/${entry}`;
      if (!/^(coretemp|k10temp|zenpower)$/.test((yield* readFile(`${path}/name`)).trim())) continue;
      const value = number(yield* readFile(`${path}/temp1_input`));
      if (value !== null) cpuTemperature = Math.max(cpuTemperature ?? -Infinity, value / 1000);
    }
    const disks = yield* Effect.forEach(
      mounts(yield* readFile("/proc/self/mountinfo")),
      (mount) =>
        Effect.tryPromise({
          try: () => NodeFSP.statfs(mount.mountPath),
          catch: (cause) => new DiskReadError({ mountPath: mount.mountPath, cause }),
        }).pipe(
          Effect.timeout("500 millis"),
          Effect.map((stat) => ({
            ...mount,
            usedBytes: Math.max(0, Math.round((stat.blocks - stat.bfree) * stat.bsize)),
            totalBytes: Math.max(0, Math.round(stat.blocks * stat.bsize)),
          })),
          Effect.orElseSucceed(() => null),
        ),
      { concurrency: 4 },
    );
    return {
      supported: true,
      sampledAt,
      cpu: {
        utilization,
        coreCount: [...cpuinfo.matchAll(/^processor\s*:/gm)].length || NodeOS.cpus().length,
        frequencyMhz: frequencies.length
          ? frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length
          : null,
        temperatureCelsius: cpuTemperature,
      },
      memory: { usedBytes: Math.max(0, totalBytes - available), totalBytes },
      disks: disks.filter((disk) => disk !== null),
      gpus: yield* readGpus(),
    } satisfies SystemResourcesSnapshot;
  });
  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_: "host") => sample(),
    timeToLive: "1 second",
  });
  return SystemResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(SystemResources, make);
