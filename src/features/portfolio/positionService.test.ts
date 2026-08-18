import { describe, expect, it } from "vitest";

import type { LedgerData } from "@/core/models";
import { createBuiltInAssets } from "@/core/catalog";
import {
  createPriceSnapshot,
  sampleTrades,
} from "@/test-support";
import { getPositionsFromLedger } from "./positionService";

function createLedgerData(
  overrides: Partial<LedgerData> = {},
): LedgerData {
  return {
    schemaVersion: 3,
    assets: createBuiltInAssets(),
    trades: [],
    cashEvents: [],
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

  it("passes price snapshots into the position calculation", () => {
    const ledgerData = createLedgerData({
        trades: sampleTrades,
        priceSnapshots: [
          createPriceSnapshot(
            "price-btc",
            "BTC",
            "70000",
            "2026-07-11",
          ),
        ],
      });
    const positions = getPositionsFromLedger(ledgerData);

    const btc = positions.find(
      (position) => position.assetSymbol === "BTC",
    );

    expect(btc?.latestPrice).toBe("70000");
    expect(btc?.marketValue).toBeDefined();
    expect(btc?.unrealizedPnl).toBeDefined();
  });

  it("keeps market value but withholds unrealized PnL for a foreign fee", () => {
    const ledgerData = createLedgerData();
    ledgerData.trades = [
      {
        ...sampleTrades[0],
        currency: "USDT",
        fee: "1",
        feeCurrency: "BNB",
      },
    ];
    ledgerData.priceSnapshots = [
      {
        ...createPriceSnapshot("price-btc", "BTC", "70000", "2026-07-11"),
        currency: "USDT",
      },
    ];

    const btc = getPositionsFromLedger(ledgerData).find(
      (position) => position.assetSymbol === "BTC",
    );

    expect(btc?.marketValue).toBeDefined();
    expect(btc?.unrealizedPnl).toBeUndefined();
    expect(btc?.feeAccountingIssues?.[0]).toEqual(
      expect.objectContaining({ tradeId: sampleTrades[0].id }),
    );
  });
});
