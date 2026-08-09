import type {
  EnvironmentId,
  OrchestrationThreadShell,
  ServerProvider,
  ServerProviderRateLimits,
} from "@t3tools/contracts";
import { providerSupportsRateLimits } from "@t3tools/contracts/settings";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { didMobileProviderResponseFinish } from "./providerRateLimits";

export function useProviderRateLimits(input: {
  environmentId: EnvironmentId;
  thread: OrchestrationThreadShell;
  provider: ServerProvider | null;
  enabled: boolean;
}): ServerProviderRateLimits | null {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const instanceId = input.thread.modelSelection.instanceId;
  const supportsRateLimits = providerSupportsRateLimits(input.provider?.driver);
  const [rateLimits, setRateLimits] = useState<ServerProviderRateLimits | null>(
    supportsRateLimits && input.enabled ? (input.provider?.rateLimits ?? null) : null,
  );
  const targetKey = `${input.environmentId}:${instanceId}`;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;

  useEffect(() => {
    setRateLimits(
      supportsRateLimits && input.enabled ? (input.provider?.rateLimits ?? null) : null,
    );
  }, [input.enabled, input.provider?.rateLimits, instanceId, supportsRateLimits]);

  const refreshRateLimits = useCallback(async () => {
    if (!supportsRateLimits || !input.enabled) return;
    const requestTargetKey = targetKey;
    const result = await refreshProviders({
      environmentId: input.environmentId,
      input: { instanceId },
    });
    if (result._tag !== "Success" || targetKeyRef.current !== requestTargetKey) return;
    const provider = result.value.providers.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (provider && providerSupportsRateLimits(provider.driver)) {
      setRateLimits(provider.rateLimits ?? null);
    }
  }, [
    input.enabled,
    input.environmentId,
    instanceId,
    refreshProviders,
    supportsRateLimits,
    targetKey,
  ]);

  useEffect(() => {
    if (!supportsRateLimits || !input.enabled) return;
    void refreshRateLimits();
  }, [input.enabled, input.thread.id, refreshRateLimits, supportsRateLimits]);

  const sessionStatus = input.thread.session?.status ?? null;
  const previousStatusRef = useRef<string | null>(sessionStatus);
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = sessionStatus;
    if (
      supportsRateLimits &&
      input.enabled &&
      didMobileProviderResponseFinish(previousStatus, sessionStatus)
    ) {
      void refreshRateLimits();
    }
  }, [input.enabled, refreshRateLimits, sessionStatus, supportsRateLimits]);

  return input.enabled ? rateLimits : null;
}
