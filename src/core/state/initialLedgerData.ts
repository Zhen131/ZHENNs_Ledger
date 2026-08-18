import type { LedgerData } from "@/core/models";
import { createBuiltInAssets } from "@/core/catalog";

export function createInitialLedgerData(): LedgerData {
  return {
    schemaVersion: 3,
    assets: createBuiltInAssets(),
    trades: [],
    cashEvents: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export const initialLedgerData = createInitialLedgerData();
