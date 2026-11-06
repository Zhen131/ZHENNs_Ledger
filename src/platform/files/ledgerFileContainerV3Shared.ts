/**
 * 这个文件管 S-1 格式检查时共用的小工具。
 * 包括做失败结果、认编号、查字段名。
 * 它不管具体查什么，那在 ledgerFileContainerV3Parse.ts。
 * 没有特别的决定。
 */

import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileContractErrorCode,
  type LedgerFileContractError,
} from "./ledgerFileContract";

/**
 * 这个函数做一条「版本号组合不认识」的失败结果。
 * 举例：调用 → 答 `LEDGER_FILE_UNSUPPORTED_VERSION`、位置 fileFormatVersion。
 */
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

/**
 * 这个函数做一条「结构不对」的失败结果。
 * 举例：传 "header.fileId"、说明 → 答 `LEDGER_FILE_INVALID_STRUCTURE` 那一条。
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

/**
 * 这个函数回答：这个值能不能当文件里的编号？
 * 要求不空、不全是空格、最多 128 个字。
 * 举例："file-1" → 答能；"   " → 答不能。
 * 它和 core 里同名的 isTechnicalId 规矩不同，故意分开。
 */
export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

/**
 * 这个函数回答：这个值是不是一个普通对象？数组和空值都不算。
 * 举例：{} → 答是；[] → 答不是。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 这个函数回答：字段名是不是正好这几个，不多不少？
 * 举例：要 ["a", "b"]，给 {a: 1, b: 2} → 答是。
 */
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
