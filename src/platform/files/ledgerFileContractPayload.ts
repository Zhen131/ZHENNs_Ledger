/**
 * 这个文件管解密后里面那一层。
 * 保存时间加整本账本，查对了才能加密或交给上层。
 * 它不管怎么加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定：存之前也要把账本完整查一遍，查不过就不存。这是猜的，日志里没写，要核。
 */

import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { isValidISODateOrDateTime } from "@/core/validation";
import { selectLedgerDataFacts, validateLedgerData } from "@/core/validation";
import type {
  DecryptedLedgerPayloadV4,
  LedgerFilePayloadValidationResult,
} from "./ledgerFileContract";
import { PAYLOAD_KEYS, LEDGER_DATA_KEYS } from "./ledgerFileContractConstants";
import { isExactObject, failure } from "./ledgerFileContractShared";

/**
 * 这个函数回答。
 * 这本账本配上保存时间，能不能变成要加密的那份内容？
 * 它查保存时间、整本账本、大小上限。
 * 通过就给出变成文字后的样子。
 * 举例：保存时间 "2026-11-06" 没有时刻 → 答不能，`LEDGER_FILE_INVALID_PAYLOAD`。
 * 举例：买卖超过 25 万笔 → 答不能，`LEDGER_FILE_RESOURCE_POLICY_FAILED`。
 * 出错时不抛错，返回 ok:false。
 */
export function createCanonicalLedgerPayloadV4(
  ledgerData: unknown,
  savedAt: string,
): LedgerFilePayloadValidationResult {
  if (
    !savedAt.includes("T") ||
    !isValidISODateOrDateTime(savedAt)
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "savedAt",
      "savedAt must be a strict ISO datetime with timezone",
    );
  }

  const ledgerResult = validateLedgerData(selectLedgerDataFacts(ledgerData));
  if (!ledgerResult.ok) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "ledgerData",
      "LedgerData failed runtime validation",
      ledgerResult.errors,
    );
  }

  const resourceResult = evaluateLedgerResourcePolicy(ledgerResult.value);
  if (!resourceResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "ledgerData",
      "LedgerData exceeds collection or string resource limits",
      resourceResult.errors,
    );
  }

  const value: DecryptedLedgerPayloadV4 = {
    savedAt,
    ledgerData: ledgerResult.value,
  };
  const serializedLedgerData = JSON.stringify(ledgerResult.value);
  const serializedPayload = JSON.stringify(value);
  const byteResult =
    evaluateLedgerFilePayloadByteLength(serializedPayload);

  if (!byteResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "payload",
      "Ledger file generation payload exceeds the 8 MiB limit",
      byteResult.errors,
    );
  }

  return {
    ok: true,
    value: {
      value,
      serializedPayload,
      serializedLedgerData,
    },
  };
}

/**
 * 这个函数回答：要加密的那段文字有没有超过文件大小上限？
 * 举例：130 MiB 的文字 → 答超了，上限 128 MiB。
 */
export function evaluateLedgerFilePayloadByteLength(
  serializedPayload: string,
) {
  return evaluateLedgerJsonResourcePolicy(serializedPayload);
}

/**
 * 这个函数回答：解密出来的东西能不能当账本用？
 * 字段必须正好是保存时间和账本七样，再交给 createCanonicalLedgerPayloadV4 查。
 * 举例：多了一个字段 → 答不能，`LEDGER_FILE_INVALID_PAYLOAD`。
 * 出错时不抛错，返回 ok:false。
 */
export function validateDecryptedLedgerPayloadV4(
  input: unknown,
): LedgerFilePayloadValidationResult {
  if (
    !isExactObject(input, PAYLOAD_KEYS) ||
    !isExactObject(input.ledgerData, LEDGER_DATA_KEYS) ||
    typeof input.savedAt !== "string"
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "payload",
      "Decrypted payload must contain exactly savedAt and LedgerData facts",
    );
  }

  return createCanonicalLedgerPayloadV4(input.ledgerData, input.savedAt);
}
