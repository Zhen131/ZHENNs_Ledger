import type { LedgerData } from "@/core/models";
import { createBuiltInAssets } from "@/core/catalog";

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

export const initialLedgerData = createInitialLedgerData();
