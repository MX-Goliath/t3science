import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProviderRateLimits,
} from "@t3tools/contracts";
import { providerSupportsRateLimits } from "@t3tools/contracts/settings";
import { PROVIDER_RATE_LIMIT_REFRESH_INTERVAL_MS } from "@t3tools/shared/providerRateLimits";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SessionPhase } from "../../types";

export function didProviderResponseFinish(previous: SessionPhase, current: SessionPhase): boolean {
  return previous === "running" && current !== "running";
}

export function useProviderRateLimits(input: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
  provider: ProviderDriverKind;
  chatKey: string;
  phase: SessionPhase;
  enabled: boolean;
  initialRateLimits: ServerProviderRateLimits | undefined;
}): ServerProviderRateLimits | null {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const supportsRateLimits = providerSupportsRateLimits(input.provider);
  const [rateLimits, setRateLimits] = useState<ServerProviderRateLimits | null>(
    supportsRateLimits && input.enabled ? (input.initialRateLimits ?? null) : null,
  );
  const targetKey = `${input.environmentId}:${input.instanceId}`;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;

  useEffect(() => {
    setRateLimits(supportsRateLimits && input.enabled ? (input.initialRateLimits ?? null) : null);
  }, [input.enabled, input.initialRateLimits, input.instanceId, supportsRateLimits]);

  const refreshRateLimits = useCallback(async () => {
    if (!supportsRateLimits || !input.enabled) return;
    const requestTargetKey = targetKey;
    const result = await refreshProviders({
      environmentId: input.environmentId,
      input: { instanceId: input.instanceId },
    });
    if (result._tag !== "Success" || targetKeyRef.current !== requestTargetKey) return;
    const provider = result.value.providers.find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    if (provider && providerSupportsRateLimits(provider.driver)) {
      setRateLimits(provider.rateLimits ?? null);
    }
  }, [
    input.enabled,
    input.environmentId,
    input.instanceId,
    refreshProviders,
    supportsRateLimits,
    targetKey,
  ]);

  useEffect(() => {
    if (!supportsRateLimits || !input.enabled) return;
    void refreshRateLimits();
  }, [input.chatKey, input.enabled, refreshRateLimits, supportsRateLimits]);

  useEffect(() => {
    if (!supportsRateLimits || !input.enabled) return;
    const intervalId = setInterval(
      () => void refreshRateLimits(),
      PROVIDER_RATE_LIMIT_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(intervalId);
  }, [input.enabled, refreshRateLimits, supportsRateLimits]);

  const previousPhaseRef = useRef(input.phase);
  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = input.phase;
    if (
      supportsRateLimits &&
      input.enabled &&
      didProviderResponseFinish(previousPhase, input.phase)
    ) {
      void refreshRateLimits();
    }
  }, [input.enabled, input.phase, refreshRateLimits, supportsRateLimits]);

  return input.enabled ? rateLimits : null;
}
