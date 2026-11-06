/**
 * 这个文件管 S-2 格式检查时共用的小工具。
 * 包括算文件该多长、认槽号、做失败结果。
 * 它不管具体查什么，那在 ledgerFileSlotContainerV3Parse.ts。
 * 没有特别的决定。
 */

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

/**
 * 这个函数回答：内容槽这么大时，整份 S-2 文件应该多少字节。
 * 举例：槽 64 KiB → 答 16 + 2 × 262144 + 3 × 65536 = 720912。
 */
export function expectedFileByteLength(bodySlotBytes: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_HEADER_SLOT_BYTES * 2 +
    bodySlotBytes * LEDGER_FILE_BODY_SLOT_COUNT
  );
}

/**
 * 这个函数回答：内容槽大小合不合规矩？规矩是整数，不小于 64 KiB，不超过上限。
 * 举例：65536 → 答合；1000 → 答不合。
 */
export function isValidBodySlotBytes(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= LEDGER_FILE_BODY_SLOT_MIN_BYTES &&
    (value as number) <= LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  );
}

/** 这个函数回答这个值是不是文件头槽编号（0 或 1）。举例：2 → 答不是。 */
export function isHeaderSlot(value: unknown): value is LedgerFileHeaderSlotV3S2 {
  return value === 0 || value === 1;
}

/** 这个函数回答这个值是不是内容槽编号（0、1 或 2）。举例：2 → 答是。 */
export function isBodySlot(value: unknown): value is LedgerFileBodySlotV3S2 {
  return value === 0 || value === 1 || value === 2;
}

/**
 * 这个函数回答：这个值能不能当文件里的编号？
 * 要求不空、不全是空格、最多 128 个字。
 * 举例："file-1" → 答能；"   " → 答不能。
 */
export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

/** 这个函数做一条「版本号组合不认识」的失败结果，代码 `LEDGER_FILE_UNSUPPORTED_VERSION`。 */
export function invalidVersion(): { ok: false; errors: LedgerFileContractError[] } {
  return failure(
    "LEDGER_FILE_UNSUPPORTED_VERSION",
    "fileFormatVersion",
    "Unsupported ledger file V3 S-2 version tuple",
  );
}

/**
 * 这个函数做一条「结构不对」的失败结果，代码 `LEDGER_FILE_INVALID_STRUCTURE`。
 * 举例：传 "header.sequence"、说明 → 答 ok:false 和这一条。
 */
export function invalid(
  path: string,
  message: string,
  cause?: unknown,
): { ok: false; errors: LedgerFileContractError[] } {
  return failure("LEDGER_FILE_INVALID_STRUCTURE", path, message, cause);
}

/**
 * 这个函数做一个只含一条错误的失败结果。
 * 错误代码由调用方给。
 * 举例：传 `LEDGER_FILE_INVALID_ENCODING`、位置、说明 → 答 ok:false 和这一条。
 */
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

/**
 * 这个函数回答：字段名是不是正好这几个，不多不少？
 * 举例：要 ["a", "b"]，给 {a: 1, b: 2, c: 3} → 答不是。
 */
export function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
