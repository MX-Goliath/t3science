// @effect-diagnostics nodeBuiltinImport:off - Pure ZIP/path validation helpers run at the Node/Electron boundary.
import * as NodePath from "node:path";

export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_PET_JSON_BYTES = 128 * 1024;
export const MAX_SPRITESHEET_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10;
export const OPENPETS_FRAME_WIDTH = 192;
export const OPENPETS_FRAME_HEIGHT = 208;
export const OPENPETS_COLUMNS = 8;
export const OPENPETS_ROWS = 9;
export const OPENPETS_SHEET_WIDTH = OPENPETS_FRAME_WIDTH * OPENPETS_COLUMNS;
export const OPENPETS_SHEET_HEIGHT = OPENPETS_FRAME_HEIGHT * OPENPETS_ROWS;

const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface PetManifest {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: "spritesheet.webp";
}

export interface SafeZipEntryPath {
  readonly originalName: string;
  readonly normalizedName: string;
  readonly topLevelDirectory: string;
  readonly relativeOutputPath: "pet.json" | "spritesheet.webp" | null;
  readonly isDirectory: boolean;
}

export interface ZipEntryForValidation {
  readonly fileName: string;
  readonly isDirectory: boolean;
  readonly isEncrypted: boolean;
  readonly compressionMethod: number;
  readonly uncompressedSize: number;
  readonly externalFileAttributes: number;
}

export function validatePetId(id: unknown): string {
  if (typeof id !== "string" || !PET_ID_PATTERN.test(id)) {
    throw new Error("Pet id must contain only lowercase ASCII letters, digits, and hyphens.");
  }
  return id;
}

export function isValidPetId(id: string): boolean {
  return PET_ID_PATTERN.test(id);
}

export function validatePetManifest(value: unknown): PetManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("pet.json must contain a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const id = validatePetId(record.id);
  const displayName = record.displayName;
  const description = record.description;
  const spritesheetPath = record.spritesheetPath;
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new Error("pet.json displayName must be a non-empty string.");
  }
  if (displayName.length > 100) {
    throw new Error("pet.json displayName is too long.");
  }
  if (typeof description !== "string" || description.length > 1_000) {
    throw new Error("pet.json description must be a string of at most 1000 characters.");
  }
  if (spritesheetPath !== "spritesheet.webp") {
    throw new Error('pet.json spritesheetPath must be exactly "spritesheet.webp".');
  }
  return {
    id,
    displayName: displayName.trim(),
    description,
    spritesheetPath,
  };
}

export function validateZipEntryName(fileName: string): SafeZipEntryPath {
  if (fileName.includes("\0")) throw new Error("ZIP entry contains a NUL byte.");
  if (fileName.includes("\\")) throw new Error("ZIP entry contains a backslash.");
  if (fileName.startsWith("/") || fileName.startsWith("//")) {
    throw new Error("ZIP entry is an absolute path.");
  }
  if (/^[a-zA-Z]:\//.test(fileName)) {
    throw new Error("ZIP entry contains a Windows drive path.");
  }
  if (fileName.includes("//")) throw new Error("ZIP entry contains an empty path segment.");

  const isDirectory = fileName.endsWith("/");
  const parts = fileName.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("ZIP entry contains path traversal.");
  }
  if (isDirectory) {
    if (parts.length !== 1) throw new Error("Only one top-level ZIP directory is supported.");
    const topLevelDirectory = parts[0] ?? "";
    return {
      originalName: fileName,
      normalizedName: topLevelDirectory,
      topLevelDirectory,
      relativeOutputPath: null,
      isDirectory: true,
    };
  }
  if (parts.length !== 1 && parts.length !== 2) {
    throw new Error("ZIP files must be at the root or under one root directory.");
  }
  const leaf = parts.at(-1);
  if (leaf !== "pet.json" && leaf !== "spritesheet.webp") {
    throw new Error(`Unexpected ZIP file: ${leaf ?? ""}`);
  }
  return {
    originalName: fileName,
    normalizedName: parts.join("/"),
    topLevelDirectory: parts.length === 1 ? "" : (parts[0] ?? ""),
    relativeOutputPath: leaf,
    isDirectory: false,
  };
}

export function validateZipEntries(
  entries: readonly ZipEntryForValidation[],
): Map<string, SafeZipEntryPath> {
  if (entries.length === 0) throw new Error("ZIP archive is empty.");
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("ZIP contains too many entries.");

  const result = new Map<string, SafeZipEntryPath>();
  const caseFolded = new Set<string>();
  let topLevelDirectory: string | null = null;
  let petJsonCount = 0;
  let spritesheetCount = 0;

  for (const entry of entries) {
    if (entry.isEncrypted) throw new Error("Encrypted ZIP entries are not supported.");
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new Error("ZIP compression must be stored or deflate.");
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw new Error("ZIP entry has an invalid size.");
    }
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error("ZIP entry is too large.");
    }
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const unixType = mode & 0o170000;
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
      throw new Error("ZIP contains a symlink or special file.");
    }
    if (!entry.isDirectory && unixType === 0o040000) {
      throw new Error("ZIP directory entry is missing its trailing slash.");
    }

    const safe = validateZipEntryName(entry.fileName);
    if (
      safe.relativeOutputPath === "spritesheet.webp" &&
      entry.uncompressedSize > MAX_SPRITESHEET_BYTES
    ) {
      throw new Error("spritesheet.webp is larger than 25 MB.");
    }
    if (safe.relativeOutputPath === "pet.json" && entry.uncompressedSize > MAX_PET_JSON_BYTES) {
      throw new Error("pet.json is larger than 128 KB.");
    }
    if (topLevelDirectory !== null && safe.topLevelDirectory !== topLevelDirectory) {
      throw new Error("ZIP contains mixed or multiple top-level layouts.");
    }
    topLevelDirectory = safe.topLevelDirectory;
    if (result.has(safe.normalizedName)) throw new Error("ZIP contains a duplicate entry.");
    const folded = safe.normalizedName.toLocaleLowerCase("en-US");
    if (caseFolded.has(folded)) throw new Error("ZIP contains a case-insensitive collision.");
    result.set(safe.normalizedName, safe);
    caseFolded.add(folded);
    if (safe.relativeOutputPath === "pet.json") petJsonCount += 1;
    if (safe.relativeOutputPath === "spritesheet.webp") spritesheetCount += 1;
  }

  if (petJsonCount !== 1 || spritesheetCount !== 1) {
    throw new Error("ZIP must contain exactly one pet.json and one spritesheet.webp.");
  }
  return result;
}

export function assertOutputPathInside(rootDirectory: string, outputPath: string): void {
  const root = NodePath.resolve(rootDirectory);
  const target = NodePath.resolve(outputPath);
  if (target !== root && !target.startsWith(`${root}${NodePath.sep}`)) {
    throw new Error("ZIP output path escapes its temporary directory.");
  }
}

export function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 16 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new Error("Spritesheet is not a WebP image.");
  }
  if (readUint32LE(bytes, 4) + 8 !== bytes.length) {
    throw new Error("Spritesheet has an invalid RIFF size.");
  }
  let extendedDimensions: { width: number; height: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.length) throw new Error("WebP chunk is truncated.");
    if (chunkType === "VP8X" && chunkSize >= 10) {
      const width = 1 + readUint24LE(bytes, dataOffset + 4);
      const height = 1 + readUint24LE(bytes, dataOffset + 7);
      extendedDimensions = assertExpectedDimensions(width, height);
    }
    if (chunkType === "VP8L" && chunkSize > 5 && bytes[dataOffset] === 0x2f) {
      const b1 = bytes[dataOffset + 1] ?? 0;
      const b2 = bytes[dataOffset + 2] ?? 0;
      const b3 = bytes[dataOffset + 3] ?? 0;
      const b4 = bytes[dataOffset + 4] ?? 0;
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      const dimensions = assertExpectedDimensions(width, height);
      assertMatchingExtendedDimensions(extendedDimensions, dimensions);
      return dimensions;
    }
    if (
      chunkType === "VP8 " &&
      chunkSize > 10 &&
      readUint24BE(bytes, dataOffset + 3) === 0x9d012a
    ) {
      const width = readUint16LE(bytes, dataOffset + 6) & 0x3fff;
      const height = readUint16LE(bytes, dataOffset + 8) & 0x3fff;
      const dimensions = assertExpectedDimensions(width, height);
      assertMatchingExtendedDimensions(extendedDimensions, dimensions);
      return dimensions;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  throw new Error("WebP image has no supported image payload.");
}

function assertMatchingExtendedDimensions(
  extended: { width: number; height: number } | null,
  payload: { width: number; height: number },
): void {
  if (extended && (extended.width !== payload.width || extended.height !== payload.height)) {
    throw new Error("WebP canvas and image payload dimensions do not match.");
  }
}

function assertExpectedDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (width !== OPENPETS_SHEET_WIDTH || height !== OPENPETS_SHEET_HEIGHT) {
    throw new Error(`Spritesheet must be ${OPENPETS_SHEET_WIDTH}x${OPENPETS_SHEET_HEIGHT} pixels.`);
  }
  return { width, height };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUint24BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}
