import { assert, describe, it } from "@effect/vitest";

import {
  readWebpDimensions,
  validatePetManifest,
  validateZipEntries,
  validateZipEntryName,
} from "./PetArchiveValidation.ts";

describe("PetArchiveValidation", () => {
  it("accepts the OpenPets manifest baseline", () => {
    assert.deepEqual(
      validatePetManifest({
        id: "some-pet",
        displayName: "Some Pet",
        description: "A test pet",
        spritesheetPath: "spritesheet.webp",
      }),
      {
        id: "some-pet",
        displayName: "Some Pet",
        description: "A test pet",
        spritesheetPath: "spritesheet.webp",
      },
    );
  });

  it("accepts root and single-folder ZIP layouts", () => {
    const root = [
      {
        fileName: "pet.json",
        isDirectory: false,
        isEncrypted: false,
        compressionMethod: 0,
        uncompressedSize: 1,
        externalFileAttributes: 0,
      },
      {
        fileName: "spritesheet.webp",
        isDirectory: false,
        isEncrypted: false,
        compressionMethod: 8,
        uncompressedSize: 2,
        externalFileAttributes: 0,
      },
    ];
    assert.lengthOf(validateZipEntries(root), 2);
    assert.lengthOf(
      validateZipEntries(
        root.map((entry) => ({ ...entry, fileName: `some-pet/${entry.fileName}` })),
      ),
      2,
    );
  });

  it("rejects unsafe paths, collisions, and payload files", () => {
    for (const name of ["../pet.json", "C:/pet.json", "pet\\json", "/pet.json", "./pet.json"]) {
      assert.throws(() => validateZipEntryName(name));
    }
    assert.throws(() =>
      validateZipEntries([
        {
          fileName: "pet.json",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
        {
          fileName: "PET.JSON",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
        {
          fileName: "spritesheet.webp",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
      ]),
    );
    assert.throws(() =>
      validateZipEntries([
        {
          fileName: "pet.json",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
        {
          fileName: "spritesheet.webp",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
        {
          fileName: "notes.txt",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
      ]),
    );
  });

  it("rejects symlink and encrypted entries", () => {
    const symlinkMode = (0o120000 << 16) >>> 0;
    assert.throws(() =>
      validateZipEntries([
        {
          fileName: "pet.json",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: symlinkMode,
        },
        {
          fileName: "spritesheet.webp",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
      ]),
    );
    assert.throws(() =>
      validateZipEntries([
        {
          fileName: "pet.json",
          isDirectory: false,
          isEncrypted: true,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
        {
          fileName: "spritesheet.webp",
          isDirectory: false,
          isEncrypted: false,
          compressionMethod: 0,
          uncompressedSize: 1,
          externalFileAttributes: 0,
        },
      ]),
    );
  });

  it("rejects a header-only WebP without an image payload", () => {
    const bytes = new Uint8Array(30);
    writeAscii(bytes, 0, "RIFF");
    writeUint32LE(bytes, 4, 22);
    writeAscii(bytes, 8, "WEBP");
    writeAscii(bytes, 12, "VP8X");
    writeUint32LE(bytes, 16, 10);
    writeUint24LE(bytes, 24, 1_535);
    writeUint24LE(bytes, 27, 1_871);
    assert.throws(() => readWebpDimensions(bytes), /image payload/);
  });
});

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    bytes[offset + index] = value.charCodeAt(index);
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint24LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}
