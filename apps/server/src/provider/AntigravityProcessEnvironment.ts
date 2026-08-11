import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

/**
 * Builds the environment inherited by `agy` without Electron's desktop marker.
 *
 * Some Linux VPN and proxy clients use `CHROME_DESKTOP` for per-application
 * routing. An external CLI must not inherit T3's desktop identity, otherwise it
 * can be routed differently from the same CLI launched in a terminal.
 */
export function makeAntigravityProcessEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const inheritedEnvironment = { ...baseEnv };
  delete inheritedEnvironment.CHROME_DESKTOP;
  return mergeProviderInstanceEnvironment(environment, inheritedEnvironment);
}
