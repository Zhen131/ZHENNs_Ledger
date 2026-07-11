import { describe, expect, it } from "vitest";

import type { LedgerData } from "../models";
import { sampleTrades } from "../test/fixtures";
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

  it("derives positions without inventing price fields", () => {
    const positions = getPositionsFromLedger(
      createLedgerData({ trades: sampleTrades }),
    );

    expect(positions.map((position) => position.assetSymbol)).toEqual([
      "BTC",
      "ETH",
      "ADA",
    ]);

    const btc = positions.find(
      (position) => position.assetSymbol === "BTC",
    );

    expect(btc?.latestPrice).toBeUndefined();
    expect(btc?.marketValue).toBeUndefined();
    expect(btc?.unrealizedPnl).toBeUndefined();
  });
});
