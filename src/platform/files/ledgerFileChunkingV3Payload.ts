/**
 * 这个文件管把解密出来的块读回成内容。
 * 再把所有块拼回一整本账本。
 * 它不管分块计划，那在 ledgerFileChunkingV3Plan.ts。
 * 不显然的决定：拼回来以后整本再查一遍，和整本存时一样严。2026-09-01 定（W15 06C 第 R-2 节 F-3）。
 */

import { isValidISODateOrDateTime } from "@/core/validation";
import { type CanonicalLedgerPayloadV4 } from "./ledgerFileContract";
import { createCanonicalLedgerPayloadV4 } from "./ledgerFileContractPayload";
import type {
  LedgerFactCollection,
  LedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3";
import { LEDGER_FACT_COLLECTIONS } from "./ledgerFileChunkingV3";
import {
  mergeLedgerDataV3S3,
  flattenLedgerData,
} from "./ledgerFileChunkingV3Shared";

/**
 * 这个函数回答：解密出的文字能不能读成一块合法内容？
 * 控制块里不许有记录；记录块的条数必须和说明里写的一样。
 * 举例：说明写 2000 条，实际只有 1999 条 → 抛错。
 * 不是合法 JSON、形状不对、写法不是标准写法时都抛错。
 */
export function parseLedgerBlockPayloadV3S3(
  serialized: string,
  role: "control" | "facts",
  expectedRecordCount: number,
): LedgerBlockPayloadV3S3 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Decrypted V3 S-3 block is not valid JSON", {
      cause: error,
    });
  }
  if (
    !isExactObject(parsed, ["ledgerData", "savedAt"] as const) ||
    typeof parsed.savedAt !== "string" ||
    !parsed.savedAt.includes("T") ||
    !isValidISODateOrDateTime(parsed.savedAt) ||
    !isExactObject(parsed.ledgerData, [
      "assetTransfers",
      "assets",
      "cashEvents",
      "feeRules",
      "priceSnapshots",
      "schemaVersion",
      "trades",
    ] as const) ||
    parsed.ledgerData.schemaVersion !== 5 ||
    !LEDGER_FACT_COLLECTIONS.every((key) =>
      Array.isArray(
        (parsed.ledgerData as Record<LedgerFactCollection, unknown>)[key],
      ),
    )
  ) {
    throw new Error("Decrypted V3 S-3 block does not use the V4 payload shape");
  }
  const payload = parsed as LedgerBlockPayloadV3S3;
  const facts = flattenLedgerData(payload.ledgerData);
  if (
    facts.length !== expectedRecordCount ||
    (role === "control" && facts.length !== 0) ||
    (role === "facts" && facts.length === 0) ||
    JSON.stringify(payload) !== serialized
  ) {
    throw new Error("Decrypted V3 S-3 block count or canonical encoding is invalid");
  }
  return payload;
}

/**
 * 这个函数把控制块和全部记录块拼回一整本账本。
 * 再整本查一遍。
 * 举例：控制块加 3 个记录块 → 答一整份检查过的内容。
 * 拼出来的账本查不过时抛错。
 */
export function mergeBlockPayloadsV3S3(
  control: LedgerBlockPayloadV3S3,
  facts: readonly LedgerBlockPayloadV3S3[],
): CanonicalLedgerPayloadV4 {
  const merged = mergeLedgerDataV3S3(facts);
  const result = createCanonicalLedgerPayloadV4(merged, control.savedAt);
  if (!result.ok) {
    throw new Error("Merged V3 S-3 blocks failed the canonical V4 payload contract", {
      cause: result.errors,
    });
  }
  return result.value;
}

function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
