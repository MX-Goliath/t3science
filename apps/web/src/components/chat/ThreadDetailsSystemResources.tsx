import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  SystemResourceDisplaySettings,
  SystemResourcesSnapshot,
} from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react";
import {
  CpuIcon,
  CircuitBoardIcon,
  HardDriveIcon,
  LayersIcon,
  MemoryStickIcon,
  MonitorIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { clientHostEnvironmentAtom } from "../../state/clientHostEnvironment";
import { useEnvironment } from "../../state/environments";
import { systemResourceHistoryAtom } from "../../state/systemResources";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsDisclosure } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

export function ThreadDetailsSystemResources({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(true);
  const environment = useEnvironment(environmentId);
  const isClientHost = useAtomValue(clientHostEnvironmentAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId, (value) => value.systemResourceDisplay);
  const hasMetrics =
    settings.cpu ||
    settings.cpuTemperature ||
    settings.cpuFrequency ||
    settings.cpuCoreCount ||
    settings.memory ||
    settings.gpu ||
    settings.gpuTemperature ||
    settings.gpuMemory ||
    settings.disks;
  if (
    isClientHost ||
    !settings.enabled ||
    !hasMetrics ||
    environment?.connection.phase !== "connected" ||
    environment.serverConfig?.environment.capabilities.systemResources !== true
  )
    return null;
  const title = gt("Remote status");
  return (
    <ThreadDetailsSection
      headingId="thread-details-resources-heading"
      title={title}
      showHeading={false}
    >
      <ThreadDetailsDisclosure
        label={title}
        icon={<MonitorIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
      />
      {expanded ? <ResourceReadings environmentId={environmentId} settings={settings} /> : null}
    </ThreadDetailsSection>
  );
}

function ResourceReadings({
  environmentId,
  settings,
}: {
  readonly environmentId: EnvironmentId;
  readonly settings: SystemResourceDisplaySettings;
}) {
  const gt = useGT();
  const locale = useLocale();
  const { snapshot, history, failed } = useAtomValue(systemResourceHistoryAtom(environmentId));
  const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
  const decimal = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const bytes = (value: number) => {
    const unit = value >= 1024 ** 4 ? "TiB" : "GiB";
    return `${decimal(value / (unit === "TiB" ? 1024 ** 4 : 1024 ** 3))} ${unit}`;
  };
  const capacity = (used: number, total: number) => `${bytes(used)} / ${bytes(total)}`;
  const temperature = (value: number | null) => (value === null ? "-" : `${decimal(value)} °C`);
  const gpuRows = snapshot?.gpus.filter((gpu) => !settings.hiddenGpuIds.includes(gpu.id)) ?? [];
  const diskRows =
    snapshot?.disks.filter((disk) => !settings.hiddenDiskIds.includes(disk.id)) ?? [];
  const hasReadings =
    settings.cpu ||
    settings.cpuTemperature ||
    settings.cpuFrequency ||
    settings.cpuCoreCount ||
    settings.memory ||
    (gpuRows.length > 0 && (settings.gpu || settings.gpuTemperature || settings.gpuMemory)) ||
    (settings.disks && diskRows.length > 0);

  return (
    <ScrollArea scrollFade className="max-h-56" data-thread-details-resource-list>
      {!snapshot || !snapshot.supported ? (
        <p className="px-2.5 py-1 text-xs text-muted-foreground">
          {failed
            ? gt("Resources unavailable. Retrying…")
            : snapshot
              ? gt("Resource monitoring is unavailable on this environment.")
              : gt("Reading system resources…")}
        </p>
      ) : !hasReadings ? (
        <p className="px-2.5 py-1 text-xs text-muted-foreground">
          {gt("No selected resources are available.")}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,5.25rem)_minmax(2rem,1fr)_2.75rem] gap-x-2 text-xs">
          {settings.cpu ? (
            <ResourceRow
              icon={<CpuIcon />}
              label="CPU"
              value={percent(snapshot.cpu.utilization)}
              color="text-sky-400"
              tooltip={gt("CPU usage over the last minute")}
            >
              <ResourceSparkline history={history} read={(sample) => sample.cpu.utilization} />
            </ResourceRow>
          ) : null}
          {settings.cpuTemperature ? (
            <ResourceDetail
              label={gt("CPU temperature")}
              value={temperature(snapshot.cpu.temperatureCelsius)}
            />
          ) : null}
          {settings.cpuFrequency ? (
            <ResourceDetail
              label={gt("CPU frequency")}
              value={
                snapshot.cpu.frequencyMhz === null
                  ? "-"
                  : `${decimal(snapshot.cpu.frequencyMhz / 1000)} GHz`
              }
            />
          ) : null}
          {settings.cpuCoreCount ? (
            <ResourceDetail label={gt("CPU cores")} value={String(snapshot.cpu.coreCount)} />
          ) : null}
          {settings.memory ? (
            <ResourceRow
              icon={<MemoryStickIcon />}
              label="RAM"
              value={percent(
                snapshot.memory.totalBytes > 0
                  ? snapshot.memory.usedBytes / snapshot.memory.totalBytes
                  : null,
              )}
              color="text-violet-400"
              tooltip={capacity(snapshot.memory.usedBytes, snapshot.memory.totalBytes)}
            >
              <ResourceBar used={snapshot.memory.usedBytes} total={snapshot.memory.totalBytes} />
            </ResourceRow>
          ) : null}
          {gpuRows.map((gpu) => (
            <div key={gpu.id} className="col-span-3 grid grid-cols-subgrid">
              {settings.gpu ? (
                <ResourceRow
                  icon={<CircuitBoardIcon />}
                  label={gpuRows.length > 1 ? gpu.name : "GPU"}
                  value={percent(gpu.utilization)}
                  color="text-emerald-400"
                  tooltip={`${gpu.name} (${gpu.id}) · ${gt("GPU usage over the last minute")}`}
                >
                  <ResourceSparkline
                    history={history}
                    read={(sample) =>
                      sample.gpus.find((entry) => entry.id === gpu.id)?.utilization ?? null
                    }
                  />
                </ResourceRow>
              ) : null}
              {settings.gpuTemperature ? (
                <ResourceDetail
                  label={
                    gpuRows.length > 1
                      ? gt("{name} temperature", { name: gpu.name })
                      : gt("GPU temperature")
                  }
                  value={temperature(gpu.temperatureCelsius)}
                />
              ) : null}
              {settings.gpuMemory ? (
                <ResourceRow
                  icon={<LayersIcon />}
                  label="VRAM"
                  value={percent(
                    gpu.memoryUsedBytes !== null &&
                      gpu.memoryTotalBytes !== null &&
                      gpu.memoryTotalBytes > 0
                      ? gpu.memoryUsedBytes / gpu.memoryTotalBytes
                      : null,
                  )}
                  color="text-amber-400"
                  tooltip={`${gpu.name} (${gpu.id}) · ${gpu.memoryUsedBytes !== null && gpu.memoryTotalBytes !== null ? capacity(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : gt("Unavailable")}`}
                >
                  <ResourceBar used={gpu.memoryUsedBytes} total={gpu.memoryTotalBytes} />
                </ResourceRow>
              ) : null}
            </div>
          ))}
          {settings.disks
            ? diskRows.map((disk) => (
                <ResourceRow
                  key={disk.id}
                  icon={<HardDriveIcon />}
                  label={disk.mountPath}
                  value={percent(disk.totalBytes > 0 ? disk.usedBytes / disk.totalBytes : null)}
                  color="text-teal-400"
                  tooltip={`${disk.label} · ${disk.mountPath}\n${capacity(disk.usedBytes, disk.totalBytes)}`}
                >
                  <ResourceBar used={disk.usedBytes} total={disk.totalBytes} />
                </ResourceRow>
              ))
            : null}
        </div>
      )}
    </ScrollArea>
  );
}

function ResourceRow({
  icon,
  label,
  value,
  tooltip,
  color,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly tooltip: string;
  readonly color: string;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${value}`}
            className="col-span-3 grid h-7 grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className="shrink-0 [&>svg]:size-3.5">
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </span>
        <span aria-hidden className={cn("min-w-0", color)}>
          {children}
        </span>
        <span className="text-right tabular-nums text-foreground/85">{value}</span>
      </TooltipTrigger>
      <TooltipPopup side="left" sideOffset={16}>
        <span className="whitespace-pre-line">{tooltip}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

function ResourceDetail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="col-span-3 flex min-h-5 items-center justify-between gap-2 px-2.5 text-2xs text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function ResourceBar({
  used,
  total,
}: {
  readonly used: number | null;
  readonly total: number | null;
}) {
  const fill =
    used !== null && total !== null && total > 0
      ? Math.min(100, Math.max(0, (used / total) * 100))
      : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-muted-foreground/20">
      <span
        className="block h-full rounded-full bg-current opacity-80"
        style={{ width: `${fill}%` }}
      />
    </span>
  );
}

function ResourceSparkline({
  history,
  read,
}: {
  readonly history: readonly SystemResourcesSnapshot[];
  readonly read: (sample: SystemResourcesSnapshot) => number | null;
}) {
  const latest = history.at(-1)?.sampledAt ?? 0;
  const path = history
    .map((sample, index) => {
      const value = read(sample);
      if (value === null) return "";
      const x = Math.max(0, 100 - (latest - sample.sampledAt) / 600);
      const y = 22 - Math.max(0, Math.min(1, value)) * 20;
      const previous = history[index - 1];
      const connected =
        previous && read(previous) !== null && sample.sampledAt - previous.sampledAt <= 5_000;
      return `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full overflow-visible">
      <path d="M0,22H100" stroke="currentColor" strokeOpacity="0.15" fill="none" />
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </svg>
  );
}
