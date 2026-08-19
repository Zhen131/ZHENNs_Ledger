import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import { createPriceSnapshot, createUsdtSimpleTrade } from "@/test-support";
import { buildTradeHeatmap } from "@/features/charts";
import { buildLedgerPnlSummary } from "./pnlSummaryService";
import { buildLedgerProjection } from "./ledgerProjection";

const TODAY = "2026-08-19";

describe("buildLedgerProjection", () => {
  it("adds signed cash to priced assets without disguising missing prices", () => {
    const ledger = createInitialLedgerData();
    ledger.cashEvents = [
      {
        id: "cash-deposit",
        occurredAt: TODAY,
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "1000",
        createdAt: `${TODAY}T01:00:00.000Z`,
        updatedAt: `${TODAY}T01:00:00.000Z`,
      },
    ];
    ledger.trades = [
      createUsdtSimpleTrade("btc-buy", "buy", "BTC", "900", TODAY),
      createUsdtSimpleTrade("eth-buy", "buy", "ETH", "100", TODAY),
    ];
    ledger.priceSnapshots = [
      createPriceSnapshot("btc-price", "BTC", "1", TODAY),
    ];

    const projection = buildLedgerProjection(ledger, {
      asOf: TODAY,
      mode: "auto",
    });

    expect(projection.cash.balance).toBe("0");
    expect(projection.valuation.pricedAssetMarketValue).toBe("900");
    expect(projection.valuation.totalAssetValue).toBe("900");
    expect(projection.valuation.complete).toBe(false);
    expect(projection.valuation.missingPriceAssets).toEqual(["ETH"]);
    expect(projection.issues).toEqual([
      expect.objectContaining({
        code: "MISSING_CURRENT_PRICE",
        assetSymbol: "ETH",
      }),
    ]);
  });

  it("preserves negative cash and reports the exact deficit", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      createUsdtSimpleTrade("btc-buy", "buy", "BTC", "100", TODAY),
    ];
    ledger.priceSnapshots = [
      createPriceSnapshot("btc-price", "BTC", "9", TODAY),
    ];

    const projection = buildLedgerProjection(ledger, {
      asOf: TODAY,
      mode: "auto",
    });

    expect(projection.cash).toEqual(
      expect.objectContaining({ balance: "-100", deficit: "100" }),
    );
    expect(projection.valuation.pricedAssetMarketValue).toBe("900");
    expect(projection.valuation.totalAssetValue).toBe("800");
    expect(projection.valuation.complete).toBe(true);
  });

  it("keeps cash events out of P&L and the trade heatmap", () => {
    const withoutCash = createInitialLedgerData();
    withoutCash.trades = [
      createUsdtSimpleTrade("btc-buy", "buy", "BTC", "1", TODAY),
    ];
    withoutCash.priceSnapshots = [
      createPriceSnapshot("btc-price", "BTC", "2", TODAY),
    ];
    const withCash = structuredClone(withoutCash);
    withCash.cashEvents = [
      {
        id: "cash-only",
        occurredAt: TODAY,
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "999",
        createdAt: `${TODAY}T01:00:00Z`,
        updatedAt: `${TODAY}T01:00:00Z`,
      },
    ];
    const options = { todayKey: TODAY, mode: "auto" as const };

    expect(buildLedgerPnlSummary(withCash, options)).toEqual(
      buildLedgerPnlSummary(withoutCash, options),
    );
    expect(buildTradeHeatmap(withCash, TODAY)).toEqual(
      buildTradeHeatmap(withoutCash, TODAY),
    );
  });
});
