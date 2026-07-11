import { describe, expect, it } from "vitest";

import type { LedgerData } from "../models";
import { getPositionsFromLedger } from "./positionService";

function createLedgerData(
  overrides: Partial<LedgerData> = {},
): LedgerData {
  return {
    schemaVersion: 1,
    assets: [],
    trades: [],
    priceSnapshots: [],
    feeRules: [],
    ...overrides,
  };
}

describe("getPositionsFromLedger", () => {
  it("returns no positions for an empty ledger", () => {
    expect(getPositionsFromLedger(createLedgerData())).toEqual([]);
  });
});
