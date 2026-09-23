import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import { PREFIX_BYTES } from "./ledgerFileSlotContainerV3Constants";

export const LEDGER_FILE_HEADER_SLOT_BYTES = 256 * 1024;
export const LEDGER_FILE_BODY_SLOT_COUNT = 3 as const;
export const LEDGER_FILE_BODY_SLOT_MIN_BYTES = 64 * 1024;
export const LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES = 64 * 1024;

export const LEDGER_FILE_OUTER_V3_S2_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerSlotBytes: LEDGER_FILE_HEADER_SLOT_BYTES,
  bodySlotCount: LEDGER_FILE_BODY_SLOT_COUNT,
  maximumBodySlotBytes: LEDGER_FILE_OUTER_V2_CONSTANTS.maximumCiphertextBytes,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

export type LedgerFileHeaderSlotV3S2 = 0 | 1;
export type LedgerFileBodySlotV3S2 = 0 | 1 | 2;

export type EncryptedLedgerGenerationV3S2 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  bodySlot: LedgerFileBodySlotV3S2;
  ivBase64Url: string;
  ciphertextBytes: Uint8Array;
};

export type LedgerFileV3S2 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  activeHeaderSlot: LedgerFileHeaderSlotV3S2;
  bodySlotBytes: number;
  bodySlotCount: 3;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3S2;
  previous: EncryptedLedgerGenerationV3S2 | null;
};

export type LedgerFileV3S2ValidationResult =
  | { ok: true; value: LedgerFileV3S2 }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileV3S2HeaderCandidate = {
  file: LedgerFileV3S2;
  currentPaddingIsZero: boolean;
  previousPaddingIsZero: boolean;
};

export type LedgerFileV3S2HeaderSlotState =
  | { slot: LedgerFileHeaderSlotV3S2; status: "empty" }
  | {
      slot: LedgerFileHeaderSlotV3S2;
      status: "invalid";
      errors: LedgerFileContractError[];
    }
  | {
      slot: LedgerFileHeaderSlotV3S2;
      status: "candidate";
      candidate: LedgerFileV3S2HeaderCandidate;
    };

export type LedgerFileV3S2CandidatesResult =
  | {
      ok: true;
      value: {
        candidates: LedgerFileV3S2HeaderCandidate[];
        headerSlots: [
          LedgerFileV3S2HeaderSlotState,
          LedgerFileV3S2HeaderSlotState,
        ];
      };
    }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileBinaryPatchV3S2 = {
  position: number;
  data: Uint8Array;
};

export type PreparedLedgerFileV3S2Write = {
  file: LedgerFileV3S2;
  serializedFile: Uint8Array;
  mode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S2[];
};

export function isLedgerFileV3S2Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export function chooseLedgerFileBodySlotBytesV3S2(
  requiredCiphertextBytes: number,
  currentBodySlotBytes?: number,
): number {
  if (
    !Number.isSafeInteger(requiredCiphertextBytes) ||
    requiredCiphertextBytes < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
    requiredCiphertextBytes > LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  ) {
    throw new Error("Ledger file V3 S-2 ciphertext cannot fit a body slot");
  }
  if (
    currentBodySlotBytes !== undefined &&
    requiredCiphertextBytes <= currentBodySlotBytes
  ) {
    return currentBodySlotBytes;
  }

  const headroomTarget = Math.ceil(requiredCiphertextBytes * 1.25);
  const growthTarget = currentBodySlotBytes
    ? Math.max(headroomTarget, currentBodySlotBytes * 2)
    : Math.max(headroomTarget, LEDGER_FILE_BODY_SLOT_MIN_BYTES);
  const boundedTarget = Math.min(
    growthTarget,
    LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes,
  );
  if (
    boundedTarget === LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  ) {
    return boundedTarget;
  }
  const aligned = Math.ceil(
    boundedTarget / LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES,
  ) * LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES;
  return Math.min(
    aligned,
    LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes,
  );
}

export function otherLedgerFileHeaderSlotV3S2(
  slot: LedgerFileHeaderSlotV3S2,
): LedgerFileHeaderSlotV3S2 {
  return slot === 0 ? 1 : 0;
}

export function nextLedgerFileBodySlotV3S2(
  file: Pick<LedgerFileV3S2, "current" | "previous">,
): LedgerFileBodySlotV3S2 {
  const occupied = new Set<LedgerFileBodySlotV3S2>([
    file.current.bodySlot,
    ...(file.previous ? [file.previous.bodySlot] : []),
  ]);
  const available = ([0, 1, 2] as const).find(
    (slot) => !occupied.has(slot),
  );
  if (available === undefined) {
    throw new Error("V3 S-2 file has no safe body slot for its next write");
  }
  return available;
}

export function ledgerFileHeaderSlotOffsetV3S2(
  slot: LedgerFileHeaderSlotV3S2,
): number {
  return PREFIX_BYTES + slot * LEDGER_FILE_HEADER_SLOT_BYTES;
}

export function ledgerFileBodySlotOffsetV3S2(
  bodySlotBytes: number,
  slot: LedgerFileBodySlotV3S2,
): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_HEADER_SLOT_BYTES * 2 +
    slot * bodySlotBytes
  );
}
