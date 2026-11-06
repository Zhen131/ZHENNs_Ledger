/**
 * 这个文件管分块时共用的小工具。
 * 包括拆成一条条记录、拼回账本、做空账本。
 * 它不管分块计划，那在 ledgerFileChunkingV3Plan.ts。
 * 没有特别的决定。
 */

import type { LedgerData } from "@/core/models";
import type {
  LedgerFactCollection,
  LedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3";
import { LEDGER_FACT_COLLECTIONS } from "./ledgerFileChunkingV3";

/** 拆出来的一条记录：属于哪种列表、编号、内容。 */
export type FactEntry = {
  collection: LedgerFactCollection;
  id: string;
  value: unknown;
};

/**
 * 这个函数把几块里的记录按块的先后拼成一本账本。
 * 举例：第 1 块 2 笔买卖、第 2 块 1 笔 → 答 3 笔，先后不变。
 */
export function mergeLedgerDataV3S3(
  facts: readonly LedgerBlockPayloadV3S3[],
): LedgerData {
  const merged = emptyLedgerData();
  for (const payload of facts) {
    for (const collection of LEDGER_FACT_COLLECTIONS) {
      collectionArray(merged, collection).push(
        ...collectionArray(payload.ledgerData, collection),
      );
    }
  }
  return merged;
}

/**
 * 这个函数把一本账本拆成一条条记录。
 * 按六种列表的固定顺序排。
 * 举例：1 个资产、2 笔买卖 → 答 3 条。
 * 有记录没有编号时抛错。
 */
export function flattenLedgerData(ledgerData: LedgerData): FactEntry[] {
  return LEDGER_FACT_COLLECTIONS.flatMap((collection) =>
    collectionArray(ledgerData, collection).map((value) => ({
      collection,
      id: factId(value),
      value,
    })),
  );
}

function factId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new Error("Every V4 ledger fact must have a non-empty id");
  }
  return value.id;
}

/**
 * 这个函数做一本六种列表全空的账本，结构版本 5。
 * 举例：调用 → 答所有列表都是空的。
 */
export function emptyLedgerData(): LedgerData {
  return {
    schemaVersion: 5,
    assets: [],
    trades: [],
    cashEvents: [],
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

/**
 * 这个函数取出账本里某一种列表。
 * 举例：传 "trades" → 答买卖列表。
 */
export function collectionArray(
  ledgerData: LedgerData,
  collection: LedgerFactCollection,
): unknown[] {
  return ledgerData[collection] as unknown[];
}
