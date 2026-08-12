// @effect-diagnostics nodeBuiltinImport:off - The test exercises a real local ZIP fixture.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { extractPetArchive, removeExtractedPetArchive } from "./PetArchiveImporter.ts";

const NodeFS = NodeFSP;

describe("PetArchiveImporter", () => {
  it("validates and extracts the bundled OpenPets archives", async () => {
    const petsDirectory = await NodeFS.mkdtemp(
      NodePath.join(process.env.TEMP ?? process.cwd(), "t3-pets-test-"),
    );
    try {
      for (const [fileName, expectedId] of [
        ["openai-codex.zip", "openai-codex"],
        ["claude.zip", "claude"],
      ] as const) {
        const result = await extractPetArchive({
          archivePath: NodePath.resolve("apps/desktop/resources/desktop-pets", fileName),
          petsDirectory,
        });
        assert.equal(result.manifest.id, expectedId);
        assert.equal(result.manifest.spritesheetPath, "spritesheet.webp");
        assert.match(result.archiveSha256, /^[A-F0-9]{64}$/);
        assert.isTrue(
          (await NodeFS.stat(NodePath.join(result.petDirectory, "spritesheet.webp"))).isFile(),
        );
        await removeExtractedPetArchive(result.stagingDirectory);
      }
    } finally {
      await NodeFS.rm(petsDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects backslash entry names before yauzl can normalize them", async () => {
    const petsDirectory = await NodeFS.mkdtemp(
      NodePath.join(process.env.TEMP ?? process.cwd(), "t3-pets-test-"),
    );
    const archivePath = NodePath.join(petsDirectory, "backslash.zip");
    try {
      const archive = Buffer.from(
        await NodeFS.readFile(
          NodePath.resolve("apps/desktop/resources/desktop-pets/openai-codex.zip"),
        ),
      );
      // The archive's root folder, which is independent of the pet id.
      replaceAllAscii(archive, "codex-openpets/pet.json", "codex-openpets\\pet.json");
      await NodeFS.writeFile(archivePath, archive);

      let failure: unknown = null;
      try {
        await extractPetArchive({ archivePath, petsDirectory });
      } catch (cause) {
        failure = cause;
      }
      assert.instanceOf(failure, Error);
      assert.match((failure as Error).message, /invalid characters|backslash/i);
    } finally {
      await NodeFS.rm(petsDirectory, { recursive: true, force: true });
    }
  });
});

function replaceAllAscii(bytes: Buffer, from: string, to: string): void {
  const source = Buffer.from(from, "ascii");
  const replacement = Buffer.from(to, "ascii");
  assert.equal(source.length, replacement.length);
  let offset = 0;
  let replacements = 0;
  while ((offset = bytes.indexOf(source, offset)) !== -1) {
    replacement.copy(bytes, offset);
    offset += replacement.length;
    replacements += 1;
  }
  assert.isAbove(replacements, 0);
}
