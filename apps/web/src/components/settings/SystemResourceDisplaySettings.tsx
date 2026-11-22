import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type SystemResourceDisplaySettings as DisplaySettings,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { useContext, useRef, useState } from "react";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

const displaySettingsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(serverEnvironment.settingsValueAtom(environmentId))?.systemResourceDisplay ??
      DEFAULT_SERVER_SETTINGS.systemResourceDisplay,
  ).pipe(Atom.withEquality(Equal.equals)),
);

function useDisplaySettings(environmentId: EnvironmentId) {
  const registry = useContext(RegistryContext);
  const atom = displaySettingsAtom(environmentId);
  const saved = useAtomValue(atom);
  const save = useUpdateEnvironmentSettings(environmentId);
  const queued = useRef<Partial<DisplaySettings> | null>(null);
  const writing = useRef(false);
  const [draft, setDraft] = useState<{
    value: DisplaySettings;
    waitingForPushFrom: DisplaySettings | null;
  } | null>(null);
  const activeDraft =
    draft && (draft.waitingForPushFrom === null || draft.waitingForPushFrom === saved)
      ? draft
      : null;
  const settings = activeDraft?.value ?? saved;

  const update = async (patch: Partial<DisplaySettings>) => {
    queued.current = { ...queued.current, ...patch };
    setDraft((current) => ({
      value: { ...(current?.waitingForPushFrom === null ? current.value : settings), ...patch },
      waitingForPushFrom: null,
    }));
    if (writing.current) return;
    writing.current = true;
    let accepted = activeDraft;
    // Coalesce edits while the host is saving and keep accepted values until its push arrives.
    while (queued.current) {
      const change = queued.current;
      queued.current = null;
      const before = registry.get(atom);
      const value = {
        ...(accepted?.waitingForPushFrom === before ? accepted.value : before),
        ...change,
      };
      const success = await new Promise<boolean>((resolve) => {
        save(
          { systemResourceDisplay: value },
          { onSaved: () => resolve(true), onFailed: () => resolve(false) },
        );
      });
      if (success) {
        const published = registry.get(atom);
        accepted = {
          value: { ...(published === before ? value : published), ...change },
          waitingForPushFrom: published,
        };
      }
    }
    writing.current = false;
    setDraft(accepted);
  };
  return { settings, update };
}

export function SystemResourceDisplaySettings({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const gt = useGT();
  const { settings, update } = useDisplaySettings(environmentId);
  const canEdit = useEnvironmentScope(environmentId, AuthSettingsWriteScope) && connected;
  const [detectDevices, setDetectDevices] = useState(false);
  const inventory = useEnvironmentQuery(
    detectDevices && connected
      ? serverEnvironment.systemResources({ environmentId, input: {} })
      : null,
  );
  const toggle = (
    key: keyof Pick<
      DisplaySettings,
      | "enabled"
      | "cpu"
      | "cpuTemperature"
      | "cpuFrequency"
      | "cpuCoreCount"
      | "memory"
      | "gpu"
      | "gpuTemperature"
      | "gpuMemory"
      | "disks"
    >,
    label: string,
  ) => (
    <label key={key} className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{label}</span>
      <Switch
        size="sm"
        aria-label={label}
        checked={settings[key]}
        disabled={!canEdit}
        onCheckedChange={(checked) => void update({ [key]: checked })}
      />
    </label>
  );
  const deviceToggle = (key: "hiddenDiskIds" | "hiddenGpuIds", id: string, label: string) => (
    <label key={id} className="flex min-w-0 items-center justify-between gap-3 py-1 text-xs">
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate" />}>{label}</TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <Switch
        size="sm"
        aria-label={label}
        checked={!settings[key].includes(id)}
        disabled={!canEdit}
        onCheckedChange={(checked) =>
          void update({
            [key]: checked ? settings[key].filter((value) => value !== id) : [...settings[key], id],
          })
        }
      />
    </label>
  );
  return (
    <div className="mt-2 border-t border-border/50 py-2">
      <p className="mb-2 text-xs text-muted-foreground">
        <T>
          Shared by all clients of this environment. Updates every 2 seconds while Thread details is
          open.
        </T>
      </p>
      {toggle("enabled", gt("Show system resources"))}
      {settings.enabled ? (
        <>
          {toggle("cpu", gt("CPU usage"))}
          {toggle("cpuTemperature", gt("CPU temperature"))}
          {toggle("cpuFrequency", gt("CPU frequency"))}
          {toggle("cpuCoreCount", gt("CPU core count"))}
          {toggle("memory", gt("RAM usage"))}
          {toggle("gpu", gt("GPU usage"))}
          {toggle("gpuTemperature", gt("GPU temperature"))}
          {toggle("gpuMemory", gt("VRAM usage"))}
          {toggle("disks", gt("Disk usage"))}
          <div className="mt-2">
            <Button
              size="xs"
              variant="outline"
              disabled={!connected || inventory.isPending}
              onClick={() => {
                if (detectDevices) inventory.refresh();
                else setDetectDevices(true);
              }}
            >
              <T>Detect disks and GPUs</T>
            </Button>
          </div>
          {inventory.error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {inventory.error}
            </p>
          ) : null}
          {inventory.data ? (
            <div className="mt-2">
              {inventory.data.disks.map((disk) =>
                deviceToggle("hiddenDiskIds", disk.id, disk.mountPath),
              )}
              {inventory.data.gpus.map((gpu) =>
                deviceToggle("hiddenGpuIds", gpu.id, `${gpu.name} (${gpu.id})`),
              )}
              {inventory.data.disks.length === 0 && inventory.data.gpus.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <T>No local disks or supported GPUs detected.</T>
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
