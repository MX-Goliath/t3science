import type {
  DesktopPetImportResult,
  DesktopPetMetadata,
  DesktopPetsState,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

let sharedState: DesktopPetsState | null = null;
let sharedHydration: Promise<void> | null = null;
const sharedListeners = new Set<(state: DesktopPetsState | null) => void>();

function publishSharedState(next: DesktopPetsState | null): void {
  sharedState = next;
  for (const listener of sharedListeners) listener(next);
}

function subscribeSharedState(listener: (state: DesktopPetsState | null) => void): () => void {
  sharedListeners.add(listener);
  return () => sharedListeners.delete(listener);
}

export function useDesktopPets() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const [state, setState] = useState<DesktopPetsState | null>(sharedState);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeSharedState(setState);
    if (!bridge?.getDesktopPetsState) {
      setLoading(false);
      publishSharedState(null);
      return unsubscribe;
    }
    if (sharedState !== null) {
      setLoading(false);
      return unsubscribe;
    }
    let active = true;
    setLoading(true);
    if (sharedHydration === null) {
      sharedHydration = bridge
        .getDesktopPetsState()
        .then((next) => {
          publishSharedState(next);
        })
        .finally(() => {
          sharedHydration = null;
        });
    }
    void sharedHydration
      .catch((cause: unknown) => {
        if (active) setError(toErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const mutate = useCallback(async (operation: () => Promise<DesktopPetsState>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      publishSharedState(next);
      return next;
    } catch (cause) {
      const message = toErrorMessage(cause);
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!bridge?.setDesktopPetsEnabled) return Promise.resolve(null);
      return mutate(() => bridge.setDesktopPetsEnabled!(enabled));
    },
    [bridge, mutate],
  );
  const assignPet = useCallback(
    (providerInstanceId: string, petId: string | null) => {
      if (!bridge?.assignDesktopPet) return Promise.resolve(null);
      return mutate(() => bridge.assignDesktopPet!({ providerInstanceId, petId }));
    },
    [bridge, mutate],
  );
  const importArchive = useCallback(async (): Promise<DesktopPetImportResult | null> => {
    if (!bridge?.importDesktopPetArchive) return null;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.importDesktopPetArchive();
      if (result.kind === "imported") publishSharedState(result.state);
      return result;
    } catch (cause) {
      setError(toErrorMessage(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, [bridge]);
  const removePet = useCallback(
    (petId: string) => {
      if (!bridge?.removeDesktopPet) return Promise.resolve(null);
      return mutate(() => bridge.removeDesktopPet!({ petId }));
    },
    [bridge, mutate],
  );

  const petsById = useMemo(
    () => new Map((state?.pets ?? []).map((pet) => [pet.id, pet])),
    [state?.pets],
  );
  const petIdByProviderInstanceId = useMemo(
    () =>
      new Map(
        (state?.assignments ?? []).map(
          (assignment) => [assignment.providerInstanceId, assignment.petId] as const,
        ),
      ),
    [state?.assignments],
  );
  const petForProvider = useCallback(
    (providerInstanceId: string | null | undefined): DesktopPetMetadata | null => {
      if (!providerInstanceId) return null;
      const petId = petIdByProviderInstanceId.get(providerInstanceId);
      return petId === undefined ? null : (petsById.get(petId) ?? null);
    },
    [petIdByProviderInstanceId, petsById],
  );

  return {
    state,
    loading,
    busy,
    error,
    setEnabled,
    assignPet,
    petForProvider,
    importArchive,
    removePet,
  };
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Desktop pet operation failed.";
}
