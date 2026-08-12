// @effect-diagnostics nodeBuiltinImport:off - ZIP extraction is an Electron main-process filesystem boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Yauzl from "yauzl";

import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_EXTRACTED_BYTES,
  MAX_PET_JSON_BYTES,
  MAX_SPRITESHEET_BYTES,
  validatePetManifest,
  validateZipEntries,
  readWebpDimensions,
  type PetManifest,
  type SafeZipEntryPath,
  type ZipEntryForValidation,
} from "./PetArchiveValidation.ts";

const NodeFS = NodeFSP;

export interface ExtractedPetArchive {
  readonly manifest: PetManifest;
  readonly archiveSha256: string;
  readonly stagingDirectory: string;
  readonly petDirectory: string;
}

interface ListedEntry {
  readonly entry: Yauzl.Entry;
  readonly safe: SafeZipEntryPath;
}

export async function extractPetArchive(input: {
  readonly archivePath: string;
  readonly petsDirectory: string;
}): Promise<ExtractedPetArchive> {
  const archiveStat = await NodeFS.lstat(input.archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
    throw new Error("Selected ZIP path is not a safe regular file.");
  }
  if (archiveStat.size > MAX_ARCHIVE_BYTES) throw new Error("ZIP archive is larger than 50 MB.");

  const archiveBytes = await NodeFS.readFile(input.archivePath);
  const archiveSha256 = NodeCrypto.createHash("sha256")
    .update(archiveBytes)
    .digest("hex")
    .toUpperCase();
  await NodeFS.mkdir(input.petsDirectory, { recursive: true });
  const stagingDirectory = await NodeFS.mkdtemp(NodePath.join(input.petsDirectory, ".import-"));
  const petDirectory = NodePath.join(stagingDirectory, "pet");
  try {
    await NodeFS.mkdir(petDirectory, { recursive: true });
    const zipFile = await openZip(input.archivePath);
    try {
      const entries = await listEntries(zipFile);
      const safeEntries = validateZipEntries(
        entries.map(
          (entry): ZipEntryForValidation => ({
            fileName: entry.fileName,
            isDirectory: entry.fileName.endsWith("/"),
            isEncrypted: (entry.generalPurposeBitFlag & 0x1) !== 0,
            compressionMethod: entry.compressionMethod,
            uncompressedSize: entry.uncompressedSize,
            externalFileAttributes: entry.externalFileAttributes,
          }),
        ),
      );
      const listed = entries.map((entry) => {
        const safe = safeEntries.get(normalizeEntryName(entry.fileName));
        if (!safe) throw new Error("ZIP entry validation did not produce a path.");
        return { entry, safe } satisfies ListedEntry;
      });

      let extractedBytes = 0;
      const files = new Map<"pet.json" | "spritesheet.webp", Buffer>();
      for (const item of listed) {
        const outputName = item.safe.relativeOutputPath;
        if (outputName === null) continue;
        const maxBytes = outputName === "pet.json" ? MAX_PET_JSON_BYTES : MAX_SPRITESHEET_BYTES;
        const content = await readEntry(zipFile, item.entry, maxBytes);
        extractedBytes += content.length;
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("ZIP expands beyond 200 MB.");
        files.set(outputName, content);
      }
      const manifestBytes = files.get("pet.json");
      const spritesheetBytes = files.get("spritesheet.webp");
      if (!manifestBytes || !spritesheetBytes) throw new Error("ZIP is missing pet files.");
      let manifest: PetManifest;
      try {
        manifest = validatePetManifest(JSON.parse(manifestBytes.toString("utf8")));
      } catch (cause) {
        throw new Error(
          `Invalid pet.json: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
      readWebpDimensions(spritesheetBytes);
      await NodeFS.writeFile(
        NodePath.join(petDirectory, "pet.json"),
        `${JSON.stringify(manifest)}\n`,
      );
      await NodeFS.writeFile(NodePath.join(petDirectory, "spritesheet.webp"), spritesheetBytes);
      return { manifest, archiveSha256, stagingDirectory, petDirectory };
    } finally {
      zipFile.close();
    }
  } catch (cause) {
    await NodeFS.rm(stagingDirectory, { recursive: true, force: true });
    throw cause;
  }
}

export async function removeExtractedPetArchive(stagingDirectory: string): Promise<void> {
  await NodeFS.rm(stagingDirectory, { recursive: true, force: true });
}

function normalizeEntryName(fileName: string): string {
  return fileName.endsWith("/") ? fileName.slice(0, -1) : fileName;
}

function openZip(filePath: string): Promise<Yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    Yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error("Could not open ZIP archive."));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function listEntries(zipFile: Yauzl.ZipFile): Promise<readonly Yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Yauzl.Entry[] = [];
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    zipFile.on("entry", (entry) => {
      entries.push(entry);
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        fail(new Error("ZIP contains too many entries."));
        zipFile.close();
        return;
      }
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    });
    zipFile.once("error", fail);
    zipFile.readEntry();
  });
}

function readEntry(zipFile: Yauzl.ZipFile, entry: Yauzl.Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Could not read ZIP entry."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const fail = (cause: unknown) => {
        stream.destroy();
        reject(cause);
      };
      stream.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) {
          fail(new Error("ZIP entry exceeds its size limit."));
          return;
        }
        chunks.push(bytes);
      });
      stream.once("error", fail);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}
