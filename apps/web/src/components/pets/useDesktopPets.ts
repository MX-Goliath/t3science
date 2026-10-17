import type {
  DesktopPetImportResult,
  DesktopPetMetadata,
  DesktopPetsState,
} from "@t3tools/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";

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
  const state = useSyncExternalStore(
    subscribeSharedState,
    () => sharedState,
    () => null,
  );
  const [loading, setLoading] = useState(
    Boolean(bridge?.getDesktopPetsState) && sharedState === null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge?.getDesktopPetsState || sharedState !== null) return;
    let active = true;
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
    };
  }, [bridge]);

  const mutate = async (operation: () => Promise<DesktopPetsState>) => {
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
  };

  const setEnabled = (enabled: boolean) => {
    if (!bridge?.setDesktopPetsEnabled) return Promise.resolve(null);
    return mutate(() => bridge.setDesktopPetsEnabled!(enabled));
  };
  const assignPet = (providerInstanceId: string, petId: string | null) => {
    if (!bridge?.assignDesktopPet) return Promise.resolve(null);
    return mutate(() => bridge.assignDesktopPet!({ providerInstanceId, petId }));
  };
  const importArchive = async (): Promise<DesktopPetImportResult | null> => {
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
  };
  const removePet = (petId: string) => {
    if (!bridge?.removeDesktopPet) return Promise.resolve(null);
    return mutate(() => bridge.removeDesktopPet!({ petId }));
  };

  const petsById = new Map((state?.pets ?? []).map((pet) => [pet.id, pet]));
  const petIdByProviderInstanceId = new Map(
    (state?.assignments ?? []).map(
      (assignment) => [assignment.providerInstanceId, assignment.petId] as const,
    ),
  );
  const petForProvider = (
    providerInstanceId: string | null | undefined,
  ): DesktopPetMetadata | null => {
    if (!providerInstanceId) return null;
    const petId = petIdByProviderInstanceId.get(providerInstanceId);
    return petId === undefined ? null : (petsById.get(petId) ?? null);
  };

  return {
    state,
    loading: loading && state === null && Boolean(bridge?.getDesktopPetsState),
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
