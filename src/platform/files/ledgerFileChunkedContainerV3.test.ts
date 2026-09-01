import { describe, expect, it } from "vitest";

import { bytesToBase64Url } from "@/platform/encryption";
import type { LedgerFileCryptoV2 } from "./ledgerFileContract";
import {
  createLedgerFileBlockAadV3S3,
  ledgerFileBodySlotOffsetV3S3,
  ledgerFileHeaderSlotOffsetV3S3,
  parseLedgerFileV3S3,
  prepareLedgerFileUpdateV3S3,
  serializeLedgerFileV3S3,
  validateLedgerFileV3S3,
  type EncryptedLedgerBlockV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";

const CRYPTO: LedgerFileCryptoV2 = {
  cryptoVersion: 1,
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    saltBase64Url: bytesToBase64Url(new Uint8Array(16).fill(7)),
  },
  cipher: {
    name: "AES-GCM",
    keyLength: 256,
    tagLength: 128,
  },
};

function block(
  blockId: string,
  role: "control" | "facts",
  order: number,
  bodySlot: number,
  fill: number,
  recordCount = role === "control" ? 0 : 1,
): EncryptedLedgerBlockV3S3 {
  return {
    blockId,
    role,
    order,
    sealed: true,
    recordCount,
    ledgerSchemaVersion: 4,
    ivBase64Url: bytesToBase64Url(new Uint8Array(12).fill(fill)),
    plaintextByteLength: 16,
    bodySlots: [bodySlot],
    ciphertextBytes: new Uint8Array(32).fill(fill),
  };
}

function generationOne(): LedgerGenerationV3S3 {
  return {
    revisionId: "revision-1",
    parentRevisionId: null,
    controlBlock: block("control", "control", 0, 0, 1),
    factBlocks: [
      block("facts-0", "facts", 0, 1, 2),
      block("facts-1", "facts", 1, 2, 3),
    ],
    openBlockId: null,
  };
}

function initialFile(): LedgerFileV3S3 {
  return {
    fileFormatVersion: 3,
    cryptoVersion: 1,
    ledgerSchemaVersion: 4,
    backupFormatVersion: 3,
    fileId: "chunked-container-test",
    sequence: 1,
    activeHeaderSlot: 0,
    recordsPerBlock: 2_000,
    bodySlotBytes: 1024 * 1024,
    bodySlotCount: 8,
    crypto: CRYPTO,
    manifestAuthIvBase64Url: bytesToBase64Url(
      new Uint8Array(12).fill(4),
    ),
    manifestAuthTagBytes: new Uint8Array(16).fill(4),
    current: generationOne(),
    previous: null,
  };
}

function nextFile(base: LedgerFileV3S3): LedgerFileV3S3 {
  const current: LedgerGenerationV3S3 = {
    revisionId: "revision-2",
    parentRevisionId: base.current.revisionId,
    controlBlock: block("control", "control", 0, 3, 5),
    factBlocks: [
      block("facts-0", "facts", 0, 4, 6),
      base.current.factBlocks[1]!,
      block("facts-2", "facts", 2, 5, 7),
    ],
    openBlockId: null,
  };
  return {
    ...base,
    sequence: 2,
    activeHeaderSlot: 1,
    manifestAuthIvBase64Url: bytesToBase64Url(
      new Uint8Array(12).fill(8),
    ),
    manifestAuthTagBytes: new Uint8Array(16).fill(8),
    current,
    previous: base.current,
  };
}

describe("LedgerFileV3 S-3 chunked container", () => {
  it("round-trips the previous delta while sharing unchanged independent blocks", () => {
    const base = initialFile();
    const baseBytes = serializeLedgerFileV3S3(base);
    const next = nextFile(base);
    const prepared = prepareLedgerFileUpdateV3S3(base, baseBytes, next);
    const parsed = parseLedgerFileV3S3(prepared.serializedFile);

    expect(prepared.mode).toBe("patch");
    expect(prepared.patches.map(({ position }) => position)).toEqual([
      ledgerFileBodySlotOffsetV3S3(3),
      ledgerFileHeaderSlotOffsetV3S3(1),
    ]);
    expect(parsed).toEqual({ ok: true, value: next });
    if (!parsed.ok || !parsed.value.previous) return;
    expect(parsed.value.current.factBlocks[1]).toEqual(
      parsed.value.previous.factBlocks[1],
    );
    expect(parsed.value.current.factBlocks[0]).not.toEqual(
      parsed.value.previous.factBlocks[0],
    );
  });

  it("does not bind one block AAD to any neighboring block", () => {
    const file = nextFile(initialFile());
    const target = file.current.factBlocks[1]!;
    const before = createLedgerFileBlockAadV3S3(file, target);
    const unrelated = file.current.factBlocks[0]!;
    unrelated.ciphertextBytes[0] ^= 0xff;
    unrelated.ivBase64Url = bytesToBase64Url(
      new Uint8Array(12).fill(9),
    );
    const after = createLedgerFileBlockAadV3S3(file, target);

    expect(after).toEqual(before);
  });

  it("keeps the old header complete until the new header patch lands", () => {
    const base = initialFile();
    const baseBytes = serializeLedgerFileV3S3(base);
    const prepared = prepareLedgerFileUpdateV3S3(
      base,
      baseBytes,
      nextFile(base),
    );
    const bodyOnly = Uint8Array.from(baseBytes);
    bodyOnly.set(prepared.patches[0]!.data, prepared.patches[0]!.position);
    const parsed = parseLedgerFileV3S3(bodyOnly);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sequence).toBe(1);
    expect(parsed.value.current.revisionId).toBe("revision-1");
  });

  it("rejects truncation, extension, non-zero block padding, and overlapping blocks", () => {
    const file = initialFile();
    const bytes = serializeLedgerFileV3S3(file);
    const extended = new Uint8Array(bytes.byteLength + 1);
    extended.set(bytes);
    const dirtyPadding = Uint8Array.from(bytes);
    dirtyPadding[ledgerFileBodySlotOffsetV3S3(0) + 32] = 1;
    const overlapping: LedgerFileV3S3 = {
      ...file,
      current: {
        ...file.current,
        factBlocks: [
          {
            ...file.current.factBlocks[0]!,
            bodySlots: file.current.controlBlock.bodySlots,
          },
          file.current.factBlocks[1]!,
        ],
      },
    };
    const reusedBlockIv: LedgerFileV3S3 = {
      ...file,
      current: {
        ...file.current,
        factBlocks: [
          {
            ...file.current.factBlocks[0]!,
            ivBase64Url: file.current.controlBlock.ivBase64Url,
          },
          file.current.factBlocks[1]!,
        ],
      },
    };
    const reusedManifestIv: LedgerFileV3S3 = {
      ...file,
      manifestAuthIvBase64Url:
        file.current.controlBlock.ivBase64Url,
    };

    expect(parseLedgerFileV3S3(bytes.subarray(0, bytes.byteLength - 1)).ok)
      .toBe(false);
    expect(parseLedgerFileV3S3(extended).ok).toBe(false);
    expect(parseLedgerFileV3S3(dirtyPadding).ok).toBe(false);
    expect(validateLedgerFileV3S3(overlapping).ok).toBe(false);
    expect(validateLedgerFileV3S3(reusedBlockIv).ok).toBe(false);
    expect(validateLedgerFileV3S3(reusedManifestIv).ok).toBe(false);
  });
});
