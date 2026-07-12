import type { LedgerData } from "../models";
import { createBuiltInAssets } from "../data/builtInAssets";

export function createInitialLedgerData(): LedgerData {
  return {
    schemaVersion: 1,
    assets: createBuiltInAssets(),
    trades: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export const initialLedgerData = createInitialLedgerData();
