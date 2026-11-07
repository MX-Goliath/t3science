import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom } from "./preferences";

export function useScienceFeature(
  key: "scienceComposer" | "scienceQueue" | "scienceScheduledSend",
) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) && preferences.value[key] === true;
}
