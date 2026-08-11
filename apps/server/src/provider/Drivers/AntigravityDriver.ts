/**
 * AntigravityDriver — `ProviderDriver` for the Antigravity CLI (`agy`).
 *
 * Mirrors the other CLI-backed drivers: a plain value whose `create()` returns
 * one `ProviderInstance` bundling `snapshot` / `adapter` / `textGeneration`
 * closures captured over the per-instance `AntigravitySettings`.
 *
 * Two probes back the snapshot and are cached separately, because they have
 * very different freshness needs: the catalog/skills probe is stable for
 * minutes, while plan limits move with every turn and the composer meters read
 * them on every thread switch.
 *
 * @module provider/Drivers/AntigravityDriver
 */
import { AntigravitySettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeAntigravityTextGeneration } from "../../textGeneration/AntigravityTextGeneration.ts";
import { makeAntigravityProcessEnvironment } from "../AntigravityProcessEnvironment.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import {
  buildInitialAntigravityProviderSnapshot,
  checkAntigravityProviderStatus,
  enrichAntigravitySnapshot,
  probeAntigravityRateLimits,
} from "../Layers/AntigravityProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  makeProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
  type ProviderMaintenanceCapabilitiesResolver,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const DRIVER_KIND = ProviderDriverKind.make("antigravity");
// Plan windows move with every turn, so the composer meters need a fresher
// probe than the catalog — but still one that coalesces the burst of refreshes
// a thread switch triggers.
const RATE_LIMITS_PROBE_TTL = Duration.seconds(30);

/** `agy update` is the CLI's own self-update path; there is no npm package. */
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (options) =>
    makeProviderMaintenanceCapabilities({
      provider: DRIVER_KIND,
      packageName: null,
      updateExecutable: options?.binaryPath?.trim() || "agy",
      updateArgs: ["update"],
      updateLockKey: "antigravity-cli",
    }),
};

export type AntigravityDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Antigravity",
    supportsMultipleInstances: true,
  },
  configSchema: AntigravitySettings,
  defaultConfig: (): AntigravitySettings => decodeAntigravitySettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const { cwd } = yield* ServerConfig;
      const processEnv = makeAntigravityProcessEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies AntigravitySettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const adapter = yield* makeAntigravityAdapter(effectiveConfig, {
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
      });
      const textGeneration = yield* makeAntigravityTextGeneration(effectiveConfig, processEnv);

      const rateLimitsProbeCache = yield* Cache.make({
        capacity: 1,
        timeToLive: RATE_LIMITS_PROBE_TTL,
        lookup: (_key: string) =>
          probeAntigravityRateLimits({
            settings: effectiveConfig,
            environment: processEnv,
            cwd,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      });

      const checkProvider = checkAntigravityProviderStatus(
        effectiveConfig,
        processEnv,
        cwd,
        effectiveConfig.showRateLimits
          ? () => Cache.get(rateLimitsProbeCache, `${instanceId}:${effectiveConfig.binaryPath}`)
          : undefined,
      ).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<AntigravitySettings>
      >({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialAntigravityProviderSnapshot(settings.provider).pipe(
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          enrichAntigravitySnapshot({
            snapshot: currentSnapshot,
            maintenanceCapabilities,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            publishSnapshot,
            httpClient,
          }),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Antigravity snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
