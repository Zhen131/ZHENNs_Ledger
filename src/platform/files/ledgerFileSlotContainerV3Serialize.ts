import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import type {
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
  LedgerFileBinaryPatchV3S2,
  PreparedLedgerFileV3S2Write,
} from "./ledgerFileSlotContainerV3";
import {
  LEDGER_FILE_HEADER_SLOT_BYTES,
  LEDGER_FILE_BODY_SLOT_COUNT,
  LEDGER_FILE_OUTER_V3_S2_CONSTANTS,
  chooseLedgerFileBodySlotBytesV3S2,
  otherLedgerFileHeaderSlotV3S2,
  nextLedgerFileBodySlotV3S2,
  ledgerFileHeaderSlotOffsetV3S2,
  ledgerFileBodySlotOffsetV3S2,
} from "./ledgerFileSlotContainerV3";
import { HEADER_JSON_LENGTH_BYTES } from "./ledgerFileSlotContainerV3Constants";
import { orderedHeader } from "./ledgerFileSlotContainerV3Header";
import { validateLedgerFileV3S2 } from "./ledgerFileSlotContainerV3Parse";
import { expectedFileByteLength } from "./ledgerFileSlotContainerV3Shared";

export function serializeLedgerFileV3S2(file: LedgerFileV3S2): Uint8Array {
  const validation = validateLedgerFileV3S2(file);
  if (!validation.ok) {
    throw new Error("Generated ledger file failed its V3 S-2 contract", {
      cause: validation.errors,
    });
  }
  const byteLength = expectedFileByteLength(file.bodySlotBytes);
  if (byteLength > LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumFileBytes) {
    throw new Error("Ledger file V3 S-2 exceeds its outer byte limit");
  }
  const bytes = new Uint8Array(byteLength);
  writePrefix(bytes, file.bodySlotBytes);
  bytes.set(
    encodeHeaderSlot(file),
    ledgerFileHeaderSlotOffsetV3S2(file.activeHeaderSlot),
  );
  bytes.set(
    encodeBodySlot(file.current, file.bodySlotBytes),
    ledgerFileBodySlotOffsetV3S2(file.bodySlotBytes, file.current.bodySlot),
  );
  if (file.previous) {
    bytes.set(
      encodeBodySlot(file.previous, file.bodySlotBytes),
      ledgerFileBodySlotOffsetV3S2(file.bodySlotBytes, file.previous.bodySlot),
    );
  }
  return bytes;
}

export function prepareLedgerFileUpdateV3S2(
  baseFile: LedgerFileV3S2,
  baseSerializedFile: Uint8Array,
  current: EncryptedLedgerGenerationV3S2,
): PreparedLedgerFileV3S2Write {
  return prepareLedgerFileWriteV3S2(
    baseFile,
    baseSerializedFile,
    current,
    baseFile.current,
  );
}

export function prepareLedgerFileRecoveryV3S2(
  baseFile: LedgerFileV3S2,
  baseSerializedFile: Uint8Array,
  current: EncryptedLedgerGenerationV3S2,
): PreparedLedgerFileV3S2Write {
  if (!baseFile.previous) {
    throw new Error("V3 S-2 recovery requires a previous generation");
  }
  return prepareLedgerFileWriteV3S2(
    baseFile,
    baseSerializedFile,
    current,
    baseFile.previous,
  );
}

function prepareLedgerFileWriteV3S2(
  baseFile: LedgerFileV3S2,
  baseSerializedFile: Uint8Array,
  current: EncryptedLedgerGenerationV3S2,
  previous: EncryptedLedgerGenerationV3S2,
): PreparedLedgerFileV3S2Write {
  const baseValidation = validateLedgerFileV3S2(baseFile);
  if (!baseValidation.ok) {
    throw new Error("V3 S-2 update base is invalid", {
      cause: baseValidation.errors,
    });
  }
  const expectedCurrentBodySlot = nextLedgerFileBodySlotV3S2(baseFile);
  if (current.bodySlot !== expectedCurrentBodySlot) {
    throw new Error("V3 S-2 update must target the body slot outside current");
  }
  if (baseFile.sequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("V3 S-2 header sequence is exhausted");
  }
  const bodySlotBytes = chooseLedgerFileBodySlotBytesV3S2(
    current.ciphertextBytes.byteLength,
    baseFile.bodySlotBytes,
  );
  const file: LedgerFileV3S2 = {
    fileFormatVersion: baseFile.fileFormatVersion,
    cryptoVersion: baseFile.cryptoVersion,
    ledgerSchemaVersion: baseFile.ledgerSchemaVersion,
    backupFormatVersion: baseFile.backupFormatVersion,
    fileId: baseFile.fileId,
    sequence: baseFile.sequence + 1,
    activeHeaderSlot: otherLedgerFileHeaderSlotV3S2(
      baseFile.activeHeaderSlot,
    ),
    bodySlotBytes,
    bodySlotCount: LEDGER_FILE_BODY_SLOT_COUNT,
    crypto: baseFile.crypto,
    current,
    previous,
  };
  const validation = validateLedgerFileV3S2(file);
  if (!validation.ok) {
    throw new Error("Prepared ledger file failed its V3 S-2 contract", {
      cause: validation.errors,
    });
  }

  if (
    bodySlotBytes !== baseFile.bodySlotBytes ||
    baseSerializedFile.byteLength !== expectedFileByteLength(bodySlotBytes)
  ) {
    return {
      file,
      serializedFile: serializeLedgerFileV3S2(file),
      mode: "replace",
      patches: [],
    };
  }

  const bodyPatch: LedgerFileBinaryPatchV3S2 = {
    position: ledgerFileBodySlotOffsetV3S2(
      bodySlotBytes,
      current.bodySlot,
    ),
    data: encodeBodySlot(current, bodySlotBytes),
  };
  const headerPatch: LedgerFileBinaryPatchV3S2 = {
    position: ledgerFileHeaderSlotOffsetV3S2(file.activeHeaderSlot),
    data: encodeHeaderSlot(file),
  };
  const serializedFile = Uint8Array.from(baseSerializedFile);
  serializedFile.set(bodyPatch.data, bodyPatch.position);
  serializedFile.set(headerPatch.data, headerPatch.position);
  return {
    file,
    serializedFile,
    mode: "patch",
    patches: [bodyPatch, headerPatch],
  };
}

function encodeHeaderSlot(file: LedgerFileV3S2): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(orderedHeader(file)));
  if (
    headerBytes.byteLength === 0 ||
    headerBytes.byteLength > LEDGER_FILE_HEADER_SLOT_BYTES - HEADER_JSON_LENGTH_BYTES
  ) {
    throw new Error("Ledger file V3 S-2 header exceeds its slot");
  }
  const slot = new Uint8Array(LEDGER_FILE_HEADER_SLOT_BYTES);
  new DataView(slot.buffer).setUint32(0, headerBytes.byteLength, true);
  slot.set(headerBytes, HEADER_JSON_LENGTH_BYTES);
  return slot;
}

function encodeBodySlot(
  generation: EncryptedLedgerGenerationV3S2,
  bodySlotBytes: number,
): Uint8Array {
  if (generation.ciphertextBytes.byteLength > bodySlotBytes) {
    throw new Error("Ledger file V3 S-2 ciphertext exceeds its body slot");
  }
  const slot = new Uint8Array(bodySlotBytes);
  slot.set(generation.ciphertextBytes, 0);
  return slot;
}

function writePrefix(bytes: Uint8Array, bodySlotBytes: number): void {
  bytes.set(LEDGER_FILE_V3_MAGIC, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(LEDGER_FILE_V3_MAGIC.byteLength, LEDGER_FILE_HEADER_SLOT_BYTES, true);
  view.setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength + Uint32Array.BYTES_PER_ELEMENT,
    bodySlotBytes,
    true,
  );
}
