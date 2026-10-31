import {
  CodexSettings,
  ProviderInstanceId,
  ProviderDriverKind,
  type ImageLibraryEntry,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveManagedCodexHomeLayout } from "../provider/CodexManagedHome.ts";

export type DiscoveredCodexImage = Omit<ImageLibraryEntry, "origin"> & { home: string };

const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

const readDirectory = Effect.fn("ImageLibrary.readDirectory")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readDirectory(directory).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
    }),
  );
});

export const discoverCodexImages = Effect.fn("ImageLibrary.discover")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const environment = yield* HostProcess.Environment;
  const current = yield* settings.getSettings;
  // Saved images remain available when an account is disabled for new turns.
  const instances = Object.entries(current.providerInstances).filter(
    ([, instance]) => instance.driver === "codex",
  );
  if (!Object.hasOwn(current.providerInstances, "codex"))
    instances.push(["codex", { driver: ProviderDriverKind.make("codex") }]);
  const roots = new Map<string, { label: string; instanceId: ProviderInstanceId; home: string }>();
  for (const [id, instance] of instances) {
    const decoded = decodeCodexSettings(instance.config ?? {});
    if (Option.isNone(decoded)) continue;
    const instanceId = ProviderInstanceId.make(id);
    const configuredHome =
      instance.environment?.findLast((entry) => entry.name === "CODEX_HOME")?.value ??
      environment.CODEX_HOME;
    const environmentHome = typeof configuredHome === "string" ? configuredHome : undefined;
    const options = decoded.value;
    const effective =
      !options.homePath.trim() && !options.shadowHomePath.trim() && environmentHome?.trim()
        ? { ...options, homePath: environmentHome }
        : options;
    const layout = yield* (
      options.setupMode === "managed"
        ? resolveManagedCodexHomeLayout(config.stateDir, instanceId, effective)
        : resolveCodexHomeLayout(effective)
    ).pipe(Effect.provideService(Path.Path, path));
    for (const home of new Set(
      [layout.sharedHomePath, layout.effectiveHomePath].filter((value) => value !== undefined),
    )) {
      const root = yield* fs
        .realPath(path.join(home, "generated_images"))
        .pipe(Effect.catchTags({ PlatformError: () => Effect.succeed(null) }));
      if (root !== null && !roots.has(root))
        roots.set(root, { label: instance.displayName?.trim() || id, instanceId, home });
    }
  }
  const images: Array<DiscoveredCodexImage> = [];
  const seen = new Set<string>();
  const walk = Effect.fn("ImageLibrary.walk")(function* (
    directory: string,
    root: string,
    depth: number,
  ): Effect.fn.Return<void, import("effect/PlatformError").PlatformError, FileSystem.FileSystem> {
    const owner = roots.get(root)!;
    for (const name of yield* readDirectory(directory)) {
      const entry = path.join(directory, name);
      const info = yield* fs
        .stat(entry)
        .pipe(Effect.catchTags({ PlatformError: () => Effect.succeed(null) }));
      if (!info) continue;
      if (info.type === "Directory" && depth < 3) {
        yield* walk(entry, root, depth + 1);
      } else if (info.type === "File" && IMAGE_EXTENSION.test(name)) {
        const canonical = yield* fs.realPath(entry);
        const relative = path.relative(root, canonical);
        if (relative.startsWith("..") || path.isAbsolute(relative) || seen.has(canonical)) continue;
        seen.add(canonical);
        const segments = path.relative(root, entry).split(path.sep);
        images.push({
          id: canonical,
          path: canonical,
          directory: path.dirname(canonical),
          fileName: name,
          createdAt: Option.getOrNull(info.mtime)?.getTime() ?? 0,
          sizeBytes: Number(info.size),
          nativeThreadId: segments.length > 1 ? segments[0]! : "",
          providerInstanceId: owner.instanceId,
          home: owner.home,
        });
      }
    }
  });
  for (const root of roots.keys()) yield* walk(root, root, 0);
  images.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  return {
    images,
    directories: [...roots].map(([root, owner]) => ({ path: root, label: owner.label })),
  };
});

export const findCodexImageTranscript = Effect.fn("ImageLibrary.findCodexImageTranscript")(
  function* (image: DiscoveredCodexImage) {
    const path = yield* Path.Path;
    let transcript: string | null = null;
    const find = Effect.fn("ImageLibrary.findTranscript")(function* (
      directory: string,
      depth: number,
    ): Effect.fn.Return<void, import("effect/PlatformError").PlatformError, FileSystem.FileSystem> {
      for (const name of yield* readDirectory(directory)) {
        if (transcript !== null) return;
        const entry = path.join(directory, name);
        if (name.endsWith(`${image.nativeThreadId}.jsonl`)) {
          transcript = entry;
          return;
        }
        if (depth < 4 && /^\d+$/.test(name)) yield* find(entry, depth + 1);
      }
    });
    for (const directory of ["sessions", "archived_sessions"]) {
      if (transcript === null) yield* find(path.join(image.home, directory), 0);
    }
    return transcript;
  },
);
