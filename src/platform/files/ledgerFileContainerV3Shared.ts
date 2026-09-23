import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileContractErrorCode,
  type LedgerFileContractError,
} from "./ledgerFileContract";

export function invalidVersion(): { ok: false; errors: LedgerFileContractError[] } {
  return {
    ok: false,
    errors: [
      {
        code: "LEDGER_FILE_UNSUPPORTED_VERSION",
        path: "fileFormatVersion",
        message: "Unsupported ledger file V3 version tuple",
      },
    ],
  };
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

export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}
