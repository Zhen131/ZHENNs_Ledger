/**
 * 这个文件管检查账本文件时共用的两个小工具。
 * 包括查字段名、做一条失败。
 * 它不管具体查什么，那在 ledgerFileContractValidate.ts 和 ledgerFileContractPayload.ts。
 * 没有特别的决定。
 */

import type {
  LedgerFileContractErrorCode,
  LedgerFileContractError,
} from "./ledgerFileContract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 这个函数回答：字段名是不是正好这几个，不多不少？
 * 传进来的字段名要先排好序。
 * 举例：要 ["a", "b"]，给 {b: 1, a: 2} → 答是；给 {a: 1} → 答不是。
 */
export function isExactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

/**
 * 这个函数做一个只含一条错误的失败结果。
 * 举例：传 `LEDGER_FILE_INVALID_PAYLOAD`、"savedAt"、说明 → 答 ok:false 和这一条。
 */
export function failure(
  code: LedgerFileContractErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): { ok: false; errors: LedgerFileContractError[] } {
  return {
    ok: false,
    errors: [{ code, path, message, ...(cause === undefined ? {} : { cause }) }],
  };
}
