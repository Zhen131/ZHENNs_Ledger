import { describe, expect, it } from "vitest";

import type { LedgerFileCryptoV2 } from "./ledgerFileContract";
import {
  LEDGER_FILE_BODY_SLOT_COUNT,
  chooseLedgerFileBodySlotBytesV3S2,
  ledgerFileBodySlotOffsetV3S2,
  ledgerFileHeaderSlotOffsetV3S2,
  nextLedgerFileBodySlotV3S2,
  type EncryptedLedgerGenerationV3S2,
  type LedgerFileBodySlotV3S2,
  type LedgerFileV3S2,
} from "./ledgerFileSlotContainerV3";
import {
  parseLedgerFileV3S2,
  readLedgerFileBodySlotV3S2,
} from "./ledgerFileSlotContainerV3Parse";
import {
  prepareLedgerFileUpdateV3S2,
  serializeLedgerFileV3S2,
} from "./ledgerFileSlotContainerV3Serialize";

const CRYPTO: LedgerFileCryptoV2 = {
  cryptoVersion: 1,
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    saltBase64Url: "AQEBAQEBAQEBAQEBAQEBAQ",
  },
  cipher: {
    name: "AES-GCM",
    keyLength: 256,
    tagLength: 128,
  },
};

function generation(
  revisionId: string,
  parentRevisionId: string | null,
  bodySlot: LedgerFileBodySlotV3S2,
  fill: number,
): EncryptedLedgerGenerationV3S2 {
  return {
    revisionId,
    parentRevisionId,
    ledgerSchemaVersion: 5,
    bodySlot,
    ivBase64Url: fill === 1
      ? "AQEBAQEBAQEBAQEB"
      : fill === 2
        ? "AgICAgICAgICAgIC"
        : "AwMDAwMDAwMDAwMD",
    ciphertextBytes: new Uint8Array(32).fill(fill),
  };
}

function initialFile(): LedgerFileV3S2 {
  const current = generation("revision-1", null, 0, 1);
  return {
    fileFormatVersion: 3,
    cryptoVersion: 1,
    ledgerSchemaVersion: 5,
    backupFormatVersion: 3,
    fileId: "file-slot-test",
    sequence: 1,
    activeHeaderSlot: 0,
    bodySlotBytes: chooseLedgerFileBodySlotBytesV3S2(
      current.ciphertextBytes.byteLength,
    ),
    bodySlotCount: LEDGER_FILE_BODY_SLOT_COUNT,
    crypto: CRYPTO,
    current,
    previous: null,
  };
}

describe("ledgerFileSlotContainerV3", () => {
  it("round-trips the fixed header and whole-ledger body slots", () => {
    const file = initialFile();
    const serialized = serializeLedgerFileV3S2(file);
    const parsed = parseLedgerFileV3S2(serialized);

    expect(parsed).toEqual({ ok: true, value: file });
    expect(readLedgerFileBodySlotV3S2(serialized, 0).subarray(0, 32))
      .toEqual(file.current.ciphertextBytes);
    expect(readLedgerFileBodySlotV3S2(serialized, 1).every((byte) => byte === 0))
      .toBe(true);
    expect(readLedgerFileBodySlotV3S2(serialized, 2).every((byte) => byte === 0))
      .toBe(true);
  });

  it("writes only the safe third body slot and alternating header slot", () => {
    const file1 = initialFile();
    const bytes1 = serializeLedgerFileV3S2(file1);
    const current2 = generation("revision-2", "revision-1", 1, 2);
    const save2 = prepareLedgerFileUpdateV3S2(file1, bytes1, current2);
    const current3 = generation("revision-3", "revision-2", 2, 3);
    const previousSlotBefore = readLedgerFileBodySlotV3S2(
      save2.serializedFile,
      current2.bodySlot,
    );
    const save3 = prepareLedgerFileUpdateV3S2(
      save2.file,
      save2.serializedFile,
      current3,
    );

    expect(save2.mode).toBe("patch");
    expect(save2.patches.map((patch) => patch.position)).toEqual([
      ledgerFileBodySlotOffsetV3S2(file1.bodySlotBytes, 1),
      ledgerFileHeaderSlotOffsetV3S2(1),
    ]);
    expect(nextLedgerFileBodySlotV3S2(save2.file)).toBe(2);
    expect(save3.mode).toBe("patch");
    expect(save3.patches.map((patch) => patch.position)).toEqual([
      ledgerFileBodySlotOffsetV3S2(file1.bodySlotBytes, 2),
      ledgerFileHeaderSlotOffsetV3S2(0),
    ]);
    expect(
      readLedgerFileBodySlotV3S2(
        save3.serializedFile,
        save3.file.previous!.bodySlot,
      ),
    ).toEqual(previousSlotBefore);
  });

  it("keeps the previously committed header valid until the new header lands", () => {
    const file1 = initialFile();
    const bytes1 = serializeLedgerFileV3S2(file1);
    const save2 = prepareLedgerFileUpdateV3S2(
      file1,
      bytes1,
      generation("revision-2", "revision-1", 1, 2),
    );
    const save3 = prepareLedgerFileUpdateV3S2(
      save2.file,
      save2.serializedFile,
      generation("revision-3", "revision-2", 2, 3),
    );
    const bodyOnly = Uint8Array.from(save2.serializedFile);
    bodyOnly.set(save3.patches[0]!.data, save3.patches[0]!.position);
    const parsed = parseLedgerFileV3S2(bodyOnly);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sequence).toBe(2);
    expect(parsed.value.current.revisionId).toBe("revision-2");
    expect(parsed.value.previous?.revisionId).toBe("revision-1");

    const tornHeader = Uint8Array.from(bodyOnly);
    tornHeader.set(
      save3.patches[1]!.data.subarray(0, 64),
      save3.patches[1]!.position,
    );
    const parsedTornHeader = parseLedgerFileV3S2(tornHeader);
    expect(parsedTornHeader.ok).toBe(true);
    if (!parsedTornHeader.ok) return;
    expect(parsedTornHeader.value.sequence).toBe(2);
    expect(parsedTornHeader.value.current.revisionId).toBe("revision-2");
  });
});
