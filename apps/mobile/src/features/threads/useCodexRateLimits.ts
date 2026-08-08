import type {
  EnvironmentId,
  OrchestrationThreadShell,
  ServerProvider,
  ServerProviderRateLimits,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { didMobileCodexResponseFinish } from "./codexRateLimits";

export function useCodexRateLimits(input: {
  environmentId: EnvironmentId;
  thread: OrchestrationThreadShell;
  provider: ServerProvider | null;
}): ServerProviderRateLimits | null {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const instanceId = input.thread.modelSelection.instanceId;
  const providerDriver = input.provider?.driver ?? null;
  const [rateLimits, setRateLimits] = useState<ServerProviderRateLimits | null>(
    providerDriver === "codex" ? (input.provider?.rateLimits ?? null) : null,
  );
  const targetKey = `${input.environmentId}:${instanceId}`;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;

  useEffect(() => {
    setRateLimits(providerDriver === "codex" ? (input.provider?.rateLimits ?? null) : null);
  }, [input.provider?.rateLimits, instanceId, providerDriver]);

  const refreshRateLimits = useCallback(async () => {
    if (providerDriver !== "codex") return;
    const requestTargetKey = targetKey;
    const result = await refreshProviders({
      environmentId: input.environmentId,
      input: { instanceId },
    });
    if (result._tag !== "Success" || targetKeyRef.current !== requestTargetKey) return;
    const provider = result.value.providers.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (provider?.driver === "codex") {
      setRateLimits(provider.rateLimits ?? null);
    }
  }, [input.environmentId, instanceId, providerDriver, refreshProviders, targetKey]);

  useEffect(() => {
    if (providerDriver !== "codex") return;
    void refreshRateLimits();
  }, [input.thread.id, providerDriver, refreshRateLimits]);

  const sessionStatus = input.thread.session?.status ?? null;
  const previousStatusRef = useRef<string | null>(sessionStatus);
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = sessionStatus;
    if (providerDriver === "codex" && didMobileCodexResponseFinish(previousStatus, sessionStatus)) {
      void refreshRateLimits();
    }
  }, [providerDriver, refreshRateLimits, sessionStatus]);

  return rateLimits;
}
