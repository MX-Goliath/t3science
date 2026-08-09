import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProviderRateLimits,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SessionPhase } from "../../types";

export function didCodexResponseFinish(previous: SessionPhase, current: SessionPhase): boolean {
  return previous === "running" && current !== "running";
}

export function useCodexRateLimits(input: {
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
  const [rateLimits, setRateLimits] = useState<ServerProviderRateLimits | null>(
    input.provider === "codex" && input.enabled ? (input.initialRateLimits ?? null) : null,
  );
  const targetKey = `${input.environmentId}:${input.instanceId}`;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;

  useEffect(() => {
    setRateLimits(
      input.provider === "codex" && input.enabled ? (input.initialRateLimits ?? null) : null,
    );
  }, [input.enabled, input.initialRateLimits, input.instanceId, input.provider]);

  const refreshRateLimits = useCallback(async () => {
    if (input.provider !== "codex" || !input.enabled) return;
    const requestTargetKey = targetKey;
    const result = await refreshProviders({
      environmentId: input.environmentId,
      input: { instanceId: input.instanceId },
    });
    if (result._tag !== "Success" || targetKeyRef.current !== requestTargetKey) return;
    const provider = result.value.providers.find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    if (provider?.driver === "codex") {
      setRateLimits(provider.rateLimits ?? null);
    }
  }, [
    input.enabled,
    input.environmentId,
    input.instanceId,
    input.provider,
    refreshProviders,
    targetKey,
  ]);

  useEffect(() => {
    if (input.provider !== "codex" || !input.enabled) return;
    void refreshRateLimits();
  }, [input.chatKey, input.enabled, input.provider, refreshRateLimits]);

  const previousPhaseRef = useRef(input.phase);
  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = input.phase;
    if (
      input.provider === "codex" &&
      input.enabled &&
      didCodexResponseFinish(previousPhase, input.phase)
    ) {
      void refreshRateLimits();
    }
  }, [input.enabled, input.phase, input.provider, refreshRateLimits]);

  return input.enabled ? rateLimits : null;
}
