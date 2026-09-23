import { byteArraysEqual } from "./byteArraysEqual";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileContractError,
} from "./ledgerFileContract";
import type {
  EncryptedLedgerBlockV3S3,
  LedgerGenerationV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
} from "./ledgerFileChunkedContainerV3";
import { PREFIX_BYTES } from "./ledgerFileChunkedContainerV3Constants";

export function uniqueReachableBlocks(file: Pick<LedgerFileV3S3, "current" | "previous">): EncryptedLedgerBlockV3S3[] {
  const blocks = [
    file.current.controlBlock,
    ...file.current.factBlocks,
    ...(file.previous
      ? [file.previous.controlBlock, ...file.previous.factBlocks]
      : []),
  ];
  const byIdentity = new Map<string, EncryptedLedgerBlockV3S3>();
  for (const block of blocks) {
    const key = JSON.stringify(block.bodySlots);
    const existing = byIdentity.get(key);
    if (existing && !sameBlock(existing, block)) {
      throw new Error("Different V3 S-3 blocks overlap the same body slots");
    }
    byIdentity.set(key, block);
  }
  return Array.from(byIdentity.values());
}

export function blocksBySlot(generation: LedgerGenerationV3S3): Map<number, EncryptedLedgerBlockV3S3> {
  const result = new Map<number, EncryptedLedgerBlockV3S3>();
  for (const block of [generation.controlBlock, ...generation.factBlocks]) {
    for (const slot of block.bodySlots) result.set(slot, block);
  }
  return result;
}

export function sameBlock(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
  return sameBlockHeader(left, right) && sameBytes(left.ciphertextBytes, right.ciphertextBytes);
}

export function sameBlockHeader(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
  return (
    left.blockId === right.blockId &&
    left.role === right.role &&
    left.order === right.order &&
    left.sealed === right.sealed &&
    left.recordCount === right.recordCount &&
    left.ledgerSchemaVersion === right.ledgerSchemaVersion &&
    left.ivBase64Url === right.ivBase64Url &&
    left.plaintextByteLength === right.plaintextByteLength &&
    left.bodySlots.length === right.bodySlots.length &&
    left.bodySlots.every((slot, index) => slot === right.bodySlots[index])
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return byteArraysEqual(left, right);
}

export function expectedFileByteLength(bodySlotCount: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    bodySlotCount * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

export function isLogicalFile(input: unknown): input is LedgerFileV3S3 {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.keys(input).sort().join("\0") ===
      [
        "activeHeaderSlot",
        "backupFormatVersion",
        "bodySlotBytes",
        "bodySlotCount",
        "crypto",
        "cryptoVersion",
        "current",
        "fileFormatVersion",
        "fileId",
        "ledgerSchemaVersion",
        "manifestAuthIvBase64Url",
        "manifestAuthTagBytes",
        "previous",
        "recordsPerBlock",
        "sequence",
      ].sort().join("\0") &&
    (input as { manifestAuthTagBytes?: unknown }).manifestAuthTagBytes instanceof Uint8Array
  );
}

export function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

export function contractError(path: string, message: string, cause?: unknown): LedgerFileContractError {
  return { code: "LEDGER_FILE_INVALID_STRUCTURE", path, message, ...(cause === undefined ? {} : { cause }) };
}

export function invalid(path: string, message: string, cause?: unknown): { ok: false; errors: LedgerFileContractError[] } {
  return { ok: false, errors: [contractError(path, message, cause)] };
}

export function invalidWithCode(
  code: LedgerFileContractError["code"],
  path: string,
  message: string,
): { ok: false; errors: LedgerFileContractError[] } {
  return { ok: false, errors: [{ code, path, message }] };
}
