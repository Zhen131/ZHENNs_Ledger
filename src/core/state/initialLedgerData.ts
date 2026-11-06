/**
 * 这个文件管一本全新账本长什么样。
 * 它不管怎么改账本，那在 ledgerReducer.ts；内置资产的内容在 catalog 区。
 * 不显然的决定：新账本自带 BTC、ETH、ADA 三个资产。2026-08-19 定（W14 01B 第 3.6 节）。
 */

import type { LedgerData } from "@/core/models";
import { createBuiltInAssets } from "@/core/catalog";

/**
 * 这个函数做一本全新的空账本。
 * 结构版本是 5，自带三个资产，别的都是空的。
 * 举例：新建账本 → 答现金余额算出来是 0，没有任何买卖。
 */
export function createInitialLedgerData(): LedgerData {
  return {
    schemaVersion: 5,
    assets: createBuiltInAssets(),
    trades: [],
    cashEvents: [],
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

/** 程序启动时先用的那本空账本。 */
export const initialLedgerData = createInitialLedgerData();
