import * as Predicate from "effect/Predicate";

/** Carries the fork's saved streaming choice into the shared response setting. */
export function migrateLegacyResponseStreaming(value: unknown): unknown {
  if (!Predicate.isObject(value)) return value;
  const choices: boolean[] = [];
  if (typeof value.enableLegacyTokenStreaming === "boolean")
    choices.push(value.enableLegacyTokenStreaming);
  if (Predicate.isObject(value.providers) && Predicate.isObject(value.providers.opencode)) {
    const choice = value.providers.opencode.enableLegacyTokenStreaming;
    if (typeof choice === "boolean") choices.push(choice);
  }
  if (Predicate.isObject(value.providerInstances)) {
    for (const instance of Object.values(value.providerInstances)) {
      if (
        !Predicate.isObject(instance) ||
        instance.driver !== "opencode" ||
        !Predicate.isObject(instance.config)
      )
        continue;
      const choice = instance.config.enableLegacyTokenStreaming;
      if (typeof choice === "boolean") choices.push(choice);
    }
  }
  const providerInstances = Predicate.isObject(value.providerInstances)
    ? Object.fromEntries(
        Object.entries(value.providerInstances).map(([id, instance]) => {
          if (
            !Predicate.isObject(instance) ||
            instance.driver !== "opencode" ||
            !Predicate.isObject(instance.config)
          )
            return [id, instance];
          const { enableLegacyTokenStreaming: _, ...config } = instance.config;
          return [id, { ...instance, config }];
        }),
      )
    : value.providerInstances;
  return {
    ...value,
    ...(providerInstances !== undefined ? { providerInstances } : {}),
    ...(value.responseStreamingMode === undefined && choices.length > 0
      ? { responseStreamingMode: choices.some(Boolean) ? "token" : "turn" }
      : {}),
  };
}
