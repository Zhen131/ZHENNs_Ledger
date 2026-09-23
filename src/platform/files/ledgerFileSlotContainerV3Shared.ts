import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileContractError,
  type LedgerFileContractErrorCode,
} from "./ledgerFileContract";
import type {
  LedgerFileHeaderSlotV3S2,
  LedgerFileBodySlotV3S2,
} from "./ledgerFileSlotContainerV3";
import {
  LEDGER_FILE_HEADER_SLOT_BYTES,
  LEDGER_FILE_BODY_SLOT_COUNT,
  LEDGER_FILE_BODY_SLOT_MIN_BYTES,
  LEDGER_FILE_OUTER_V3_S2_CONSTANTS,
} from "./ledgerFileSlotContainerV3";
import { PREFIX_BYTES } from "./ledgerFileSlotContainerV3Constants";

export function expectedFileByteLength(bodySlotBytes: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_HEADER_SLOT_BYTES * 2 +
    bodySlotBytes * LEDGER_FILE_BODY_SLOT_COUNT
  );
}

export function isValidBodySlotBytes(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= LEDGER_FILE_BODY_SLOT_MIN_BYTES &&
    (value as number) <= LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  );
}

export function isHeaderSlot(value: unknown): value is LedgerFileHeaderSlotV3S2 {
  return value === 0 || value === 1;
}

export function isBodySlot(value: unknown): value is LedgerFileBodySlotV3S2 {
  return value === 0 || value === 1 || value === 2;
}

export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

export function invalidVersion(): { ok: false; errors: LedgerFileContractError[] } {
  return failure(
    "LEDGER_FILE_UNSUPPORTED_VERSION",
    "fileFormatVersion",
    "Unsupported ledger file V3 S-2 version tuple",
  );
}

export function invalid(
  path: string,
  message: string,
  cause?: unknown,
): { ok: false; errors: LedgerFileContractError[] } {
  return failure("LEDGER_FILE_INVALID_STRUCTURE", path, message, cause);
}

export function failure(
  code: LedgerFileContractErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): { ok: false; errors: LedgerFileContractError[] } {
  return {
    ok: false,
    errors: [
      {
        code,
        path,
        message,
        ...(cause === undefined ? {} : { cause }),
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
