import { describe, expect, it } from "vitest";

import type { LedgerData, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { buildLedgerPnlSummary } from "./pnlSummaryService";

const TODAY = "2026-08-09";
const TIMESTAMP = "2026-08-09T00:00:00Z";

function trade(
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
    | "fee"
  > &
    Partial<Pick<Trade, "assetSymbol" | "currency" | "feeCurrency">>,
): Trade {
  const currency = overrides.currency ?? "USDT";
  return {
    timePrecision: "day",
    assetSymbol: overrides.assetSymbol ?? "BTC",
    currency,
    feeCurrency: overrides.feeCurrency ?? currency,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function fixedLedger(withPrice = true): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [
    trade({
      id: "buy",
      occurredAt: "2026-08-01",
      type: "buy",
      quantity: "0.1",
      price: "65000",
      totalValue: "6500",
      fee: "5",
    }),
    trade({
      id: "sell",
      occurredAt: "2026-08-02",
      type: "sell",
      quantity: "0.04",
      price: "70000",
      totalValue: "2800",
      fee: "3",
    }),
  ];
  ledgerData.priceSnapshots = withPrice
    ? [
        {
          id: "btc-price",
          assetSymbol: "BTC",
          price: "80000",
          currency: "USDT",
          recordedAt: TODAY,
          source: "manual",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ]
    : [];
  return ledgerData;
}

describe("PnL summary", () => {
  it("uses the same fee-aware replay and cash-impact amounts as the fixed example", () => {
    const summary = buildLedgerPnlSummary(fixedLedger(), {
      todayKey: TODAY,
      mode: "auto",
    });

    expect(summary.buyOutflow).toEqual({ value: "6505", missingReasons: [] });
    expect(summary.sellProceeds).toEqual({ value: "2797", missingReasons: [] });
    expect(summary.remainingCostBasis).toEqual({
      value: "3903",
      missingReasons: [],
    });
    expect(summary.realizedPnl).toEqual({ value: "195", missingReasons: [] });
    expect(summary.unrealizedPnl).toEqual({
      value: "897",
      missingReasons: [],
    });
    expect(summary.valuation.label).toBe("USDT");
  });

  it("keeps a missing price missing instead of adding zero", () => {
    const summary = buildLedgerPnlSummary(fixedLedger(false), {
      todayKey: TODAY,
      mode: "auto",
    });

    expect(summary.unrealizedPnl.value).toBeUndefined();
    expect(summary.unrealizedPnl.missingReasons).toEqual([
      "BTC 缺少合法当前价格",
    ]);
    expect(summary.missingPriceAssets).toEqual(["BTC"]);
  });

  it("withholds fee-sensitive totals after a foreign fee without guessing a rate", () => {
    const ledgerData = fixedLedger();
    ledgerData.trades[0] = {
      ...ledgerData.trades[0],
      feeCurrency: "BNB",
    };

    const summary = buildLedgerPnlSummary(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });

    expect(summary.buyOutflow.value).toBeUndefined();
    expect(summary.sellProceeds.value).toBe("2797");
    expect(summary.remainingCostBasis.value).toBeUndefined();
    expect(summary.realizedPnl.value).toBeUndefined();
    expect(summary.unrealizedPnl.value).toBeUndefined();
    expect(summary.feeAccountingIssues).toEqual([
      expect.objectContaining({
        tradeId: "buy",
        fee: "5",
        feeCurrency: "BNB",
        tradeCurrency: "USDT",
      }),
    ]);
  });

  it("labels a cross-asset USD and USDT aggregation as approximate", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[1] = {
      ...ledgerData.assets[1],
      quoteCurrency: "USD" as never,
    };
    ledgerData.trades = [
      trade({
        id: "btc-usdt",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "10",
        totalValue: "10",
        fee: "0",
      }),
      trade({
        id: "eth-usd",
        occurredAt: "2026-08-01",
        type: "buy",
        assetSymbol: "ETH",
        quantity: "1",
        price: "20",
        totalValue: "20",
        fee: "0",
        currency: "USD" as never,
        feeCurrency: "USD",
      }),
    ];

    const summary = buildLedgerPnlSummary(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });

    expect(summary.buyOutflow.value).toBe("30");
    expect(summary.valuation).toEqual({
      label: "USD/USDT 近似等值",
      usesApproximation: true,
    });
  });
});
