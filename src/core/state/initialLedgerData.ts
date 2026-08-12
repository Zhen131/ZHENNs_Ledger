import type { LedgerData } from "@/core/models";
import { createBuiltInAssets } from "@/core/catalog";

export function createInitialLedgerData(): LedgerData {
  return {
    schemaVersion: 2,
    assets: createBuiltInAssets(),
    trades: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export const initialLedgerData = createInitialLedgerData();
