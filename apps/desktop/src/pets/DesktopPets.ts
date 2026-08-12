// @effect-diagnostics nodeBuiltinImport:off - Desktop pet storage is a local Electron boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { DesktopPetMetadata, DesktopPetsState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { getDesktopOrigin } from "../electron/ElectronProtocol.ts";
import {
  extractPetArchive,
  removeExtractedPetArchive,
  type ExtractedPetArchive,
} from "./PetArchiveImporter.ts";
import {
  assertOutputPathInside,
  isValidPetId,
  MAX_PET_JSON_BYTES,
  MAX_SPRITESHEET_BYTES,
  readWebpDimensions,
  validatePetManifest,
  type PetManifest,
} from "./PetArchiveValidation.ts";

const NodeFS = NodeFSP;

const PETS_STATE_VERSION = 2;
const MAX_INSTALLED_PETS = 100;
const MAX_PET_ASSIGNMENTS = 500;
const MAX_PROVIDER_INSTANCE_ID_LENGTH = 200;

const BUNDLED_PETS = [
  {
    id: "openai-codex",
    archiveFileName: "desktop-pets/openai-codex.zip",
    archiveSha256: "1F697AC69481C21AE0AB05A6EA681C14FEB67F2A27CEE421BD45C761ED58A72B",
  },
  {
    id: "claude",
    archiveFileName: "desktop-pets/claude.zip",
    archiveSha256: "EA7FB03D465D7E604201212607586D3043B488093FEB35B3FFEA8EB1E8440077",
  },
] as const;

const BUNDLED_PET_IDS = new Set<string>(BUNDLED_PETS.map((pet) => pet.id));

/**
 * Seeded once, when no assignment map has ever been persisted (fresh
 * install, or an upgrade from the single-pet state format). A built-in
 * provider slot's instance id is its driver kind, so these ids pair the two
 * bundled pets with the providers they depict. Everything afterwards is the
 * user's: clearing an assignment is persisted as an absent entry and is
 * never re-seeded.
 */
const DEFAULT_PET_ASSIGNMENTS: ReadonlyArray<readonly [string, string]> = [
  ["codex", "openai-codex"],
  ["claudeAgent", "claude"],
];

export class DesktopPetUnknownIdError extends Schema.TaggedErrorClass<DesktopPetUnknownIdError>()(
  "DesktopPetUnknownIdError",
  { petId: Schema.String },
) {
  override get message(): string {
    return `Unknown desktop pet "${this.petId}".`;
  }
}

export class DesktopPetProtectedError extends Schema.TaggedErrorClass<DesktopPetProtectedError>()(
  "DesktopPetProtectedError",
  { petId: Schema.String },
) {
  override get message(): string {
    return `Built-in desktop pet "${this.petId}" cannot be replaced or removed.`;
  }
}

export class DesktopPetOperationError extends Schema.TaggedErrorClass<DesktopPetOperationError>()(
  "DesktopPetOperationError",
  { operation: Schema.String, messageText: Schema.String },
) {
  override get message(): string {
    return `Desktop pet operation "${this.operation}" failed: ${this.messageText}`;
  }
}

interface StoredPet {
  readonly manifest: PetManifest;
  readonly source: "bundled" | "user-import";
  readonly protected: boolean;
  readonly archiveSha256: string;
}

interface RuntimeState {
  enabled: boolean;
  /** Provider instance id -> installed pet id. */
  assignments: ReadonlyMap<string, string>;
  pets: ReadonlyMap<string, StoredPet>;
  errors: string[];
}

interface PersistedPet {
  readonly source: "bundled" | "user-import";
  readonly protected: boolean;
  readonly archiveSha256: string;
}

interface PersistedState {
  readonly version: 2;
  readonly enabled: boolean;
  readonly assignments: Record<string, string> | null;
  readonly pets: Record<string, unknown>;
}

export interface DesktopPetSpritesheet {
  readonly filePath: string;
  readonly assetRevision: string;
}

export class DesktopPets extends Context.Service<
  DesktopPets,
  {
    readonly initialize: Effect.Effect<void, DesktopPetOperationError>;
    readonly getState: Effect.Effect<DesktopPetsState, DesktopPetOperationError>;
    readonly setEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopPetsState, DesktopPetOperationError>;
    readonly assign: (
      providerInstanceId: string,
      petId: string | null,
    ) => Effect.Effect<DesktopPetsState, DesktopPetOperationError | DesktopPetUnknownIdError>;
    readonly importArchive: (
      archivePath: string,
    ) => Effect.Effect<DesktopPetsState, DesktopPetOperationError | DesktopPetProtectedError>;
    readonly remove: (
      petId: string,
    ) => Effect.Effect<
      DesktopPetsState,
      DesktopPetOperationError | DesktopPetUnknownIdError | DesktopPetProtectedError
    >;
    readonly resolveSpritesheet: (
      petId: string,
    ) => Effect.Effect<DesktopPetSpritesheet | null, DesktopPetOperationError>;
  }
>()("@t3tools/desktop/pets/DesktopPets") {}

function defaultRuntimeState(): RuntimeState {
  return { enabled: true, assignments: new Map(), pets: new Map(), errors: [] };
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const petsDirectory = NodePath.join(environment.stateDir, "desktop-pets");
  const installedDirectory = NodePath.join(petsDirectory, "installed");
  const statePath = NodePath.join(petsDirectory, "state.json");
  const stateRef = yield* Ref.make<RuntimeState>(defaultRuntimeState());
  const initializedRef = yield* Ref.make(false);

  const initialize = Effect.fn("desktop.pets.initialize")(function* () {
    if (yield* Ref.get(initializedRef)) return;
    const loaded = yield* Effect.tryPromise({
      try: () => initializeFromDisk({ environment, petsDirectory, installedDirectory, statePath }),
      catch: (cause) => toOperationError("initialize", cause),
    });
    yield* Ref.set(stateRef, loaded);
    yield* Ref.set(initializedRef, true);
  });
  const initializeEffect = initialize();

  const getRuntimeState = Effect.gen(function* () {
    yield* initializeEffect;
    return yield* Ref.get(stateRef);
  });

  const publicState = (runtime: RuntimeState): DesktopPetsState => ({
    supported: true,
    enabled: runtime.enabled,
    assignments: [...runtime.assignments.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerInstanceId, petId]) => ({ providerInstanceId, petId })),
    pets: [...runtime.pets.values()]
      .sort((left, right) => left.manifest.displayName.localeCompare(right.manifest.displayName))
      .map((pet) => toMetadata(environment.isDevelopment, pet)),
    errors: runtime.errors,
  });

  const persist = (runtime: RuntimeState) =>
    Effect.tryPromise({
      try: () => writePersistedState(statePath, runtime),
      catch: (cause) => toOperationError("persist", cause),
    });

  const setEnabled = Effect.fn("desktop.pets.setEnabled")(function* (enabled: boolean) {
    const current = yield* getRuntimeState;
    const next = { ...current, enabled };
    yield* persist(next);
    yield* Ref.set(stateRef, next);
    return publicState(next);
  });

  const assign = Effect.fn("desktop.pets.assign")(function* (
    providerInstanceId: string,
    petId: string | null,
  ) {
    const current = yield* getRuntimeState;
    const instanceId = providerInstanceId.trim();
    if (instanceId.length === 0 || instanceId.length > MAX_PROVIDER_INSTANCE_ID_LENGTH) {
      return yield* new DesktopPetOperationError({
        operation: "assign",
        messageText: "Provider instance id is empty or too long.",
      });
    }
    if (petId !== null && !current.pets.has(petId)) {
      return yield* new DesktopPetUnknownIdError({ petId });
    }
    if (
      petId !== null &&
      !current.assignments.has(instanceId) &&
      current.assignments.size >= MAX_PET_ASSIGNMENTS
    ) {
      return yield* new DesktopPetOperationError({
        operation: "assign",
        messageText: `At most ${MAX_PET_ASSIGNMENTS} provider pet assignments can be stored.`,
      });
    }
    const assignments = new Map(current.assignments);
    if (petId === null) assignments.delete(instanceId);
    else assignments.set(instanceId, petId);
    const next: RuntimeState = { ...current, assignments };
    yield* persist(next);
    yield* Ref.set(stateRef, next);
    return publicState(next);
  });

  const importArchive = Effect.fn("desktop.pets.importArchive")(function* (archivePath: string) {
    const current = yield* getRuntimeState;
    const extracted = yield* Effect.tryPromise({
      try: () => extractPetArchive({ archivePath, petsDirectory }),
      catch: (cause) => toOperationError("import", cause),
    });
    if (BUNDLED_PET_IDS.has(extracted.manifest.id)) {
      yield* Effect.promise(() => removeExtractedPetArchive(extracted.stagingDirectory));
      return yield* new DesktopPetProtectedError({ petId: extracted.manifest.id });
    }
    if (current.pets.size >= MAX_INSTALLED_PETS && !current.pets.has(extracted.manifest.id)) {
      yield* Effect.promise(() => removeExtractedPetArchive(extracted.stagingDirectory));
      return yield* new DesktopPetOperationError({
        operation: "import",
        messageText: `At most ${MAX_INSTALLED_PETS} pets can be installed.`,
      });
    }

    const storedPet: StoredPet = {
      manifest: extracted.manifest,
      source: "user-import",
      protected: false,
      archiveSha256: extracted.archiveSha256,
    };
    const committed = yield* Effect.tryPromise({
      try: () => commitExtractedPet(extracted, installedDirectory),
      catch: (cause) => toOperationError("import", cause),
    });
    const next: RuntimeState = {
      ...current,
      pets: new Map(current.pets).set(storedPet.manifest.id, storedPet),
      errors: current.errors.filter((error) => !error.includes(storedPet.manifest.id)),
    };
    const persisted = yield* Effect.result(persist(next));
    if (Result.isFailure(persisted)) {
      yield* Effect.promise(() => rollbackCommittedPet(committed));
      return yield* persisted.failure;
    }
    if (committed.backup) {
      yield* Effect.promise(() =>
        NodeFS.rm(committed.backup!, { recursive: true, force: true }).catch(() => undefined),
      );
    }
    yield* Ref.set(stateRef, next);
    return publicState(next);
  });

  const remove = Effect.fn("desktop.pets.remove")(function* (petId: string) {
    const current = yield* getRuntimeState;
    const pet = current.pets.get(petId);
    if (!pet) return yield* new DesktopPetUnknownIdError({ petId });
    if (pet.protected) return yield* new DesktopPetProtectedError({ petId });
    const target = NodePath.join(installedDirectory, petId);
    const backup = `${target}.remove-${NodeCrypto.randomUUID()}`;
    yield* Effect.tryPromise({
      try: async () => {
        await assertInstalledDirectory(target, installedDirectory);
        await NodeFS.rename(target, backup);
      },
      catch: (cause) => toOperationError("remove", cause),
    });
    const nextPets = new Map(current.pets);
    nextPets.delete(petId);
    const next: RuntimeState = {
      ...current,
      // Providers pointing at the removed pet fall back to the plain dots
      // indicator rather than silently inheriting someone else's companion.
      assignments: withoutAssignmentsForPet(current.assignments, petId),
      pets: nextPets,
    };
    const persisted = yield* Effect.result(persist(next));
    if (Result.isFailure(persisted)) {
      yield* Effect.promise(() => NodeFS.rename(backup, target));
      return yield* persisted.failure;
    }
    yield* Effect.promise(() =>
      NodeFS.rm(backup, { recursive: true, force: true }).catch(() => undefined),
    );
    yield* Ref.set(stateRef, next);
    return publicState(next);
  });

  const resolveSpritesheet = Effect.fn("desktop.pets.resolveSpritesheet")(function* (
    petId: string,
  ) {
    const runtime = yield* getRuntimeState;
    const pet = runtime.pets.get(petId);
    if (!pet) return null;
    const petDirectory = NodePath.join(installedDirectory, petId);
    const spritesheetPath = NodePath.join(petDirectory, "spritesheet.webp");
    yield* Effect.tryPromise({
      try: () => assertInstalledFile(spritesheetPath, petDirectory),
      catch: (cause) => toOperationError("resolve-spritesheet", cause),
    });
    return { filePath: spritesheetPath, assetRevision: pet.archiveSha256 };
  });

  return DesktopPets.of({
    initialize: initializeEffect,
    getState: getRuntimeState.pipe(Effect.map(publicState)),
    setEnabled,
    assign,
    importArchive,
    remove,
    resolveSpritesheet,
  });
});

export const layer = Layer.effect(DesktopPets, make);

function toMetadata(isDevelopment: boolean, pet: StoredPet): DesktopPetMetadata {
  const origin = getDesktopOrigin(isDevelopment);
  const encodedId = encodeURIComponent(pet.manifest.id);
  return {
    id: pet.manifest.id,
    displayName: pet.manifest.displayName,
    description: pet.manifest.description,
    source: pet.source,
    protected: pet.protected,
    assetRevision: pet.archiveSha256,
    spritesheetUrl: `${origin}/__desktop-pets/${encodedId}/spritesheet.webp?v=${encodeURIComponent(pet.archiveSha256)}`,
  };
}

async function initializeFromDisk(input: {
  readonly environment: DesktopEnvironment.DesktopEnvironment["Service"];
  readonly petsDirectory: string;
  readonly installedDirectory: string;
  readonly statePath: string;
}): Promise<RuntimeState> {
  await NodeFS.mkdir(input.petsDirectory, { recursive: true });
  await assertSafeDirectory(input.petsDirectory);
  await NodeFS.mkdir(input.installedDirectory, { recursive: true });
  await assertSafeDirectory(input.installedDirectory);
  const persisted = await readPersistedState(input.statePath);
  const pets = new Map<string, StoredPet>();
  const errors: string[] = [];
  const names = await NodeFS.readdir(input.installedDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  names.sort((left, right) => {
    const leftBundled = BUNDLED_PET_IDS.has(left.name) ? 0 : 1;
    const rightBundled = BUNDLED_PET_IDS.has(right.name) ? 0 : 1;
    return leftBundled - rightBundled;
  });
  for (const name of names) {
    if (!isValidPetId(name.name)) continue;
    if (name.isSymbolicLink()) {
      errors.push(`${name.name}: pet directory is a symlink and was skipped.`);
      continue;
    }
    if (!name.isDirectory()) {
      errors.push(`${name.name}: pet entry is not a directory and was skipped.`);
      continue;
    }
    if (pets.size >= MAX_INSTALLED_PETS) {
      errors.push(
        `${name.name}: ignored because the installed pet limit is ${MAX_INSTALLED_PETS}.`,
      );
      continue;
    }
    const storedValue = persisted?.pets[name.name];
    const stored = asPersistedPet(storedValue);
    if (storedValue !== undefined && stored === null) {
      errors.push(`${name.name}: state metadata was invalid and was rebuilt.`);
    }
    try {
      const manifest = await readPetManifest(
        NodePath.join(input.installedDirectory, name.name),
        name.name,
        stored === null,
      );
      const archiveSha256 =
        stored?.archiveSha256 ??
        (await hashFile(NodePath.join(input.installedDirectory, name.name, "spritesheet.webp")));
      pets.set(name.name, {
        manifest,
        archiveSha256,
        source: BUNDLED_PET_IDS.has(name.name) ? "bundled" : (stored?.source ?? "user-import"),
        protected: BUNDLED_PET_IDS.has(name.name) || stored?.protected === true,
      });
    } catch (cause) {
      errors.push(`${name.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  for (const bundled of BUNDLED_PETS) {
    if (pets.has(bundled.id)) continue;
    try {
      const archivePath = await resolveBundledArchive(input.environment, bundled);
      if (pets.size >= MAX_INSTALLED_PETS) {
        throw new Error(`The installed pet limit is ${MAX_INSTALLED_PETS}.`);
      }
      const extracted = await extractPetArchive({
        archivePath,
        petsDirectory: input.petsDirectory,
      });
      if (
        extracted.manifest.id !== bundled.id ||
        extracted.archiveSha256 !== bundled.archiveSha256
      ) {
        await removeExtractedPetArchive(extracted.stagingDirectory);
        throw new Error("Bundled archive does not match its descriptor.");
      }
      const committed = await commitExtractedPet(extracted, input.installedDirectory);
      if (committed.backup) {
        await NodeFS.rm(committed.backup, { recursive: true, force: true }).catch(() => undefined);
      }
      pets.set(bundled.id, {
        manifest: extracted.manifest,
        source: "bundled",
        protected: true,
        archiveSha256: extracted.archiveSha256,
      });
    } catch (cause) {
      errors.push(`${bundled.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  for (const petId of Object.keys(persisted?.pets ?? {})) {
    if (
      isValidPetId(petId) &&
      !pets.has(petId) &&
      !errors.some((error) => error.startsWith(`${petId}:`))
    ) {
      errors.push(`${petId}: installed pet directory is missing or invalid.`);
    }
  }

  const runtime: RuntimeState = {
    enabled: persisted?.enabled ?? true,
    assignments: resolveAssignments(persisted?.assignments ?? null, pets),
    pets,
    errors,
  };
  try {
    await writePersistedState(input.statePath, runtime);
  } catch (cause) {
    runtime.errors.push(`state.json: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return runtime;
}

async function resolveBundledArchive(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  bundled: (typeof BUNDLED_PETS)[number],
): Promise<string> {
  for (const candidate of environment.resolveResourcePathCandidates(bundled.archiveFileName)) {
    if (await isRegularFile(candidate)) return candidate;
  }
  throw new Error(`Bundled archive "${bundled.archiveFileName}" is missing.`);
}

async function readPersistedState(statePath: string): Promise<PersistedState | null> {
  try {
    const value: unknown = JSON.parse(await NodeFS.readFile(statePath, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== PETS_STATE_VERSION || typeof record.enabled !== "boolean") return null;
    const pets = record.pets;
    if (typeof pets !== "object" || pets === null || Array.isArray(pets)) return null;
    return {
      version: PETS_STATE_VERSION,
      enabled: record.enabled,
      assignments: asPersistedAssignments(record.assignments),
      pets: pets as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function asPersistedPet(value: unknown): PersistedPet | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (record.source !== "bundled" && record.source !== "user-import") ||
    typeof record.protected !== "boolean" ||
    typeof record.archiveSha256 !== "string" ||
    !/^[A-F0-9]{64}$/i.test(record.archiveSha256)
  ) {
    return null;
  }
  return {
    source: record.source,
    protected: record.protected,
    archiveSha256: record.archiveSha256.toUpperCase(),
  };
}

async function writePersistedState(statePath: string, runtime: RuntimeState): Promise<void> {
  await NodeFS.mkdir(NodePath.dirname(statePath), { recursive: true });
  const document: PersistedState = {
    version: PETS_STATE_VERSION,
    enabled: runtime.enabled,
    assignments: Object.fromEntries(runtime.assignments),
    pets: Object.fromEntries(
      [...runtime.pets.entries()].map(([id, pet]) => [
        id,
        {
          source: pet.source,
          protected: pet.protected,
          archiveSha256: pet.archiveSha256,
        } satisfies PersistedPet,
      ]),
    ),
  };
  const temporaryPath = `${statePath}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
  await NodeFS.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  try {
    await NodeFS.rename(temporaryPath, statePath);
  } catch (cause) {
    await NodeFS.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
}

async function readPetManifest(
  petDirectory: string,
  expectedPetId: string,
  validateSpritesheet: boolean,
): Promise<PetManifest> {
  const manifestPath = NodePath.join(petDirectory, "pet.json");
  const spritesheetPath = NodePath.join(petDirectory, "spritesheet.webp");
  await assertSafeDirectory(petDirectory);
  await assertInstalledFile(manifestPath, petDirectory);
  await assertInstalledFile(spritesheetPath, petDirectory);
  const manifestBytes = await NodeFS.readFile(manifestPath);
  if (manifestBytes.byteLength > MAX_PET_JSON_BYTES) {
    throw new Error("pet.json is larger than 128 KB.");
  }
  const manifest = validatePetManifest(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.id !== expectedPetId) {
    throw new Error(`pet.json id must match its installed directory "${expectedPetId}".`);
  }
  const spritesheetInfo = await NodeFS.lstat(spritesheetPath);
  if (spritesheetInfo.size <= 0 || spritesheetInfo.size > MAX_SPRITESHEET_BYTES) {
    throw new Error("spritesheet.webp has an invalid file size.");
  }
  if (validateSpritesheet) readWebpDimensions(await NodeFS.readFile(spritesheetPath));
  return manifest;
}

async function commitExtractedPet(
  extracted: ExtractedPetArchive,
  installedDirectory: string,
): Promise<{ target: string; backup: string | null }> {
  const target = NodePath.join(installedDirectory, extracted.manifest.id);
  await assertOutputPathInside(installedDirectory, target);
  await NodeFS.mkdir(installedDirectory, { recursive: true });
  let backup: string | null = null;
  if (await pathExists(target)) {
    backup = `${target}.replace-${NodeCrypto.randomUUID()}`;
    await NodeFS.rename(target, backup);
  }
  try {
    await NodeFS.rename(extracted.petDirectory, target);
  } catch (cause) {
    if (backup && (await pathExists(backup)) && !(await pathExists(target))) {
      await NodeFS.rename(backup, target).catch(() => undefined);
    }
    await NodeFS.rm(extracted.stagingDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw cause;
  }
  await NodeFS.rm(extracted.stagingDirectory, { recursive: true, force: true }).catch(
    () => undefined,
  );
  return { target, backup };
}

async function rollbackCommittedPet(commit: {
  target: string;
  backup: string | null;
}): Promise<void> {
  await NodeFS.rm(commit.target, { recursive: true, force: true });
  if (commit.backup) await NodeFS.rename(commit.backup, commit.target);
}

async function assertInstalledDirectory(
  directory: string,
  installedDirectory: string,
): Promise<void> {
  await assertOutputPathInside(installedDirectory, directory);
  await assertSafeDirectory(directory);
}

async function assertSafeDirectory(directory: string): Promise<void> {
  const info = await NodeFS.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Pet directory is not a safe directory.");
}

async function assertInstalledFile(filePath: string, parentDirectory: string): Promise<void> {
  await assertOutputPathInside(parentDirectory, filePath);
  await assertSafeDirectory(parentDirectory);
  const info = await NodeFS.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Pet asset is not a safe regular file.");
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const info = await NodeFS.lstat(filePath);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await NodeFS.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const bytes = await NodeFS.readFile(filePath);
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function asPersistedAssignments(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const assignments: Record<string, string> = {};
  for (const [providerInstanceId, petId] of Object.entries(value as Record<string, unknown>)) {
    if (
      providerInstanceId.length === 0 ||
      providerInstanceId.length > MAX_PROVIDER_INSTANCE_ID_LENGTH ||
      typeof petId !== "string" ||
      !isValidPetId(petId)
    ) {
      continue;
    }
    assignments[providerInstanceId] = petId;
  }
  return assignments;
}

/**
 * Drop assignments whose pet is no longer installed, and seed the built-in
 * pairings when nothing has ever been persisted. A persisted-but-empty map
 * means the user cleared every assignment, so it is left alone.
 */
function resolveAssignments(
  persisted: Record<string, string> | null,
  pets: ReadonlyMap<string, StoredPet>,
): ReadonlyMap<string, string> {
  const source: ReadonlyArray<readonly [string, string]> =
    persisted === null ? DEFAULT_PET_ASSIGNMENTS : Object.entries(persisted);
  const assignments = new Map<string, string>();
  for (const [providerInstanceId, petId] of source) {
    if (!pets.has(petId)) continue;
    if (assignments.size >= MAX_PET_ASSIGNMENTS) break;
    assignments.set(providerInstanceId, petId);
  }
  return assignments;
}

function withoutAssignmentsForPet(
  assignments: ReadonlyMap<string, string>,
  petId: string,
): ReadonlyMap<string, string> {
  const next = new Map(assignments);
  for (const [providerInstanceId, assignedPetId] of assignments) {
    if (assignedPetId === petId) next.delete(providerInstanceId);
  }
  return next;
}

function toOperationError(operation: string, cause: unknown): DesktopPetOperationError {
  return new DesktopPetOperationError({
    operation,
    messageText: cause instanceof Error ? cause.message : String(cause),
  });
}
