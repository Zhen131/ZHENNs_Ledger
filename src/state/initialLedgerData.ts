import type { LedgerData } from "../models";

export function createInitialLedgerData(): LedgerData {
  return {
    schemaVersion: 1,
    assets: [],
    trades: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export const initialLedgerData = createInitialLedgerData();
