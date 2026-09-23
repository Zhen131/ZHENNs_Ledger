import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import type {
  EncryptedLedgerBlockV3S3,
  LedgerFileV3S3,
  LedgerFileBinaryPatchV3S3,
  PreparedLedgerFileV3S3Write,
} from "./ledgerFileChunkedContainerV3";
import {
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  otherLedgerFileHeaderSlotV3S3,
  ledgerFileHeaderSlotOffsetV3S3,
  ledgerFileBodySlotOffsetV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  createLedgerFileManifestAadV3S3,
} from "./ledgerFileChunkedContainerV3Aad";
import {
  HEADER_JSON_LENGTH_BYTES,
} from "./ledgerFileChunkedContainerV3Constants";
import { validateLedgerFileV3S3 } from "./ledgerFileChunkedContainerV3Parse";
import {
  uniqueReachableBlocks,
  sameBlock,
  expectedFileByteLength,
} from "./ledgerFileChunkedContainerV3Shared";

export function serializeLedgerFileV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  const validation = validateLedgerFileV3S3(file);
  if (!validation.ok) {
    throw new Error("Generated ledger file failed its V3 S-3 contract", {
      cause: validation.errors,
    });
  }
  const byteLength = expectedFileByteLength(file.bodySlotCount);
  const bytes = new Uint8Array(byteLength);
  writePrefix(bytes);
  bytes.set(
    encodeHeaderSlot(file),
    ledgerFileHeaderSlotOffsetV3S3(file.activeHeaderSlot),
  );
  for (const block of uniqueReachableBlocks(file)) {
    writeBlock(bytes, block);
  }
  return bytes;
}

export function prepareLedgerFileUpdateV3S3(
  baseFile: LedgerFileV3S3,
  baseSerializedFile: Uint8Array,
  nextFile: LedgerFileV3S3,
): PreparedLedgerFileV3S3Write {
  const baseValidation = validateLedgerFileV3S3(baseFile);
  const nextValidation = validateLedgerFileV3S3(nextFile);
  if (!baseValidation.ok || !nextValidation.ok) {
    throw new Error("V3 S-3 update requires valid base and candidate files", {
      cause: !baseValidation.ok ? baseValidation.errors : nextValidation.ok ? [] : nextValidation.errors,
    });
  }
  if (
    nextFile.fileId !== baseFile.fileId ||
    nextFile.sequence !== baseFile.sequence + 1 ||
    nextFile.activeHeaderSlot !==
      otherLedgerFileHeaderSlotV3S3(baseFile.activeHeaderSlot) ||
    nextFile.current.parentRevisionId !== nextFile.previous?.revisionId ||
    !(
      nextFile.previous.revisionId === baseFile.current.revisionId ||
      nextFile.previous.revisionId === baseFile.previous?.revisionId
    )
  ) {
    throw new Error("V3 S-3 update does not extend the verified base");
  }

  if (
    nextFile.bodySlotCount !== baseFile.bodySlotCount ||
    baseSerializedFile.byteLength !== expectedFileByteLength(baseFile.bodySlotCount)
  ) {
    return {
      file: nextFile,
      serializedFile: serializeLedgerFileV3S3(nextFile),
      mode: "replace",
      patches: [],
    };
  }

  const baseBlocks = new Map(
    uniqueReachableBlocks(baseFile).map((block) => [block.blockId, block]),
  );
  const changedBlocks = uniqueReachableBlocks(nextFile).filter((block) => {
    const base = baseBlocks.get(block.blockId);
    return !base || !sameBlock(base, block);
  });
  const bodyPatches = mergeContiguousPatches(
    changedBlocks.flatMap(blockPatches),
  );
  const headerPatch: LedgerFileBinaryPatchV3S3 = {
    position: ledgerFileHeaderSlotOffsetV3S3(nextFile.activeHeaderSlot),
    data: encodeHeaderSlot(nextFile),
  };
  const serializedFile = Uint8Array.from(baseSerializedFile);
  for (const patch of bodyPatches) {
    serializedFile.set(patch.data, patch.position);
  }
  serializedFile.set(headerPatch.data, headerPatch.position);
  return {
    file: nextFile,
    serializedFile,
    mode: "patch",
    patches: [...bodyPatches, headerPatch],
  };
}

function writeBlock(bytes: Uint8Array, block: EncryptedLedgerBlockV3S3): void {
  let copied = 0;
  for (const slot of block.bodySlots) {
    const offset = ledgerFileBodySlotOffsetV3S3(slot);
    const take = Math.min(
      LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
      block.ciphertextBytes.byteLength - copied,
    );
    bytes.set(block.ciphertextBytes.subarray(copied, copied + take), offset);
    copied += take;
  }
}

function blockPatches(block: EncryptedLedgerBlockV3S3): LedgerFileBinaryPatchV3S3[] {
  return block.bodySlots.map((slot, index) => {
    const start = index * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES;
    const data = new Uint8Array(LEDGER_FILE_V3_S3_BODY_SLOT_BYTES);
    data.set(block.ciphertextBytes.subarray(start, start + data.byteLength));
    return { position: ledgerFileBodySlotOffsetV3S3(slot), data };
  });
}

function mergeContiguousPatches(
  patches: LedgerFileBinaryPatchV3S3[],
): LedgerFileBinaryPatchV3S3[] {
  const ordered = [...patches].sort(
    (left, right) => left.position - right.position,
  );
  const merged: LedgerFileBinaryPatchV3S3[] = [];
  for (const patch of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.position + previous.data.byteLength === patch.position
    ) {
      const data = new Uint8Array(
        previous.data.byteLength + patch.data.byteLength,
      );
      data.set(previous.data);
      data.set(patch.data, previous.data.byteLength);
      merged[merged.length - 1] = { position: previous.position, data };
    } else {
      merged.push(patch);
    }
  }
  return merged;
}

function encodeHeaderSlot(file: LedgerFileV3S3): Uint8Array {
  const json = createLedgerFileManifestAadV3S3(file);
  const maximumJsonBytes =
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES -
    HEADER_JSON_LENGTH_BYTES -
    LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES;
  if (json.byteLength > maximumJsonBytes) {
    throw new Error("Ledger file V3 S-3 header exceeds its fixed slot");
  }
  const bytes = new Uint8Array(LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES);
  new DataView(bytes.buffer).setUint32(0, json.byteLength, true);
  bytes.set(json, HEADER_JSON_LENGTH_BYTES);
  bytes.set(
    file.manifestAuthTagBytes,
    bytes.byteLength - LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  );
  return bytes;
}

function writePrefix(bytes: Uint8Array): void {
  bytes.set(LEDGER_FILE_V3_MAGIC);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(LEDGER_FILE_V3_MAGIC.byteLength, LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES, true);
  view.setUint32(LEDGER_FILE_V3_MAGIC.byteLength + 4, LEDGER_FILE_V3_S3_BODY_SLOT_BYTES, true);
}
