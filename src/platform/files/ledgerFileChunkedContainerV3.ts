import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import { PREFIX_BYTES } from "./ledgerFileChunkedContainerV3Constants";

export const RECORDS_PER_LEDGER_BLOCK = 2_000;
export const LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES = 256 * 1024;
export const LEDGER_FILE_V3_S3_BODY_SLOT_BYTES = 1024 * 1024;
export const LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES = 16;

export const LEDGER_FILE_OUTER_V3_S3_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerSlotBytes: LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

export type LedgerFileHeaderSlotV3S3 = 0 | 1;
export type LedgerFileBlockRoleV3S3 = "control" | "facts";

export type EncryptedLedgerBlockV3S3 = {
  blockId: string;
  role: LedgerFileBlockRoleV3S3;
  order: number;
  sealed: boolean;
  recordCount: number;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  plaintextByteLength: number;
  bodySlots: number[];
  ciphertextBytes: Uint8Array;
};

export type LedgerGenerationV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: EncryptedLedgerBlockV3S3;
  factBlocks: EncryptedLedgerBlockV3S3[];
  openBlockId: string | null;
};

export type LedgerFileV3S3 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  activeHeaderSlot: LedgerFileHeaderSlotV3S3;
  recordsPerBlock: number;
  bodySlotBytes: number;
  bodySlotCount: number;
  crypto: LedgerFileCryptoV2;
  manifestAuthIvBase64Url: string;
  manifestAuthTagBytes: Uint8Array;
  current: LedgerGenerationV3S3;
  previous: LedgerGenerationV3S3 | null;
};

export type LedgerFileV3S3ValidationResult =
  | { ok: true; value: LedgerFileV3S3 }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileV3S3HeaderCandidate = {
  file: LedgerFileV3S3;
  headerSlot: LedgerFileHeaderSlotV3S3;
  referencedPaddingIsZero: boolean;
};

export type LedgerFileV3S3CandidatesResult =
  | {
      ok: true;
      value: {
        candidates: LedgerFileV3S3HeaderCandidate[];
        reachableBodySlots: number[];
      };
    }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileBinaryPatchV3S3 = {
  position: number;
  data: Uint8Array;
};

export type PreparedLedgerFileV3S3Write = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  mode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
};

export function isLedgerFileV3S3Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export function otherLedgerFileHeaderSlotV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): LedgerFileHeaderSlotV3S3 {
  return slot === 0 ? 1 : 0;
}

export function ledgerFileHeaderSlotOffsetV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): number {
  return PREFIX_BYTES + slot * LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES;
}

export function ledgerFileBodySlotOffsetV3S3(slot: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    slot * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

export function ledgerFileBodySlotsRequiredV3S3(
  ciphertextByteLength: number,
): number {
  if (
    !Number.isSafeInteger(ciphertextByteLength) ||
    ciphertextByteLength < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes
  ) {
    throw new Error("V3 S-3 ciphertext length is invalid");
  }
  return Math.ceil(
    ciphertextByteLength / LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  );
}
