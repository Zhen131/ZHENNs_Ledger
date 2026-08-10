import type { LedgerData } from "../models";
import { createBuiltInAssets } from "../data/builtInAssets";

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
