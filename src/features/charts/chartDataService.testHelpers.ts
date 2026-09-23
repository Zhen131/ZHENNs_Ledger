import type { PriceSnapshot, Trade } from "@/core/models";
import { add } from "@/core/shared";
import { createPriceSnapshot, createSimpleTrade } from "@/test-support";
import { type LedgerProjection } from "@/features/portfolio";

export const TODAY = "2026-07-25";

export function apiPrice(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, assetSymbol, price, recordedAt),
    currency: "USDT",
    source: "api",
    binanceProvenance: {
      provider: "binance",
      symbol: `${assetSymbol}USDT`,
      sourceQuoteCurrency: "USDT",
      fetchedAt: `${recordedAt}T12:00:00Z`,
    },
  };
}

export function buy(
  id: string,
  assetSymbol: string,
  quantity: string,
  totalValue: string,
  occurredAt: string,
): Trade {
  return {
    ...createSimpleTrade(id, "buy", assetSymbol, quantity, occurredAt),
    price: totalValue,
    totalValue,
    currency: "USDT",
    feeCurrency: "USDT",
  };
}

export function manualPrice(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, assetSymbol, price, recordedAt),
    currency: "USDT",
  };
}

export function allocationProjection(
  entries: readonly Readonly<{
    assetSymbol: string;
    marketValue: string;
    source?: "manual" | "binance";
  }>[],
  cashBalance = "0",
): LedgerProjection {
  const pricedAssetMarketValue = entries.reduce(
    (sum, entry) => add(sum, entry.marketValue),
    "0",
  );
  const selectedPricesByAsset = Object.fromEntries(
    entries.map((entry) => [
      entry.assetSymbol,
      { source: entry.source ?? "manual", asOf: TODAY },
    ]),
  );
  return {
    cash: {
      currency: "USDT",
      balance: cashBalance,
      deficit: "0",
      effects: [],
    },
    positions: entries.map((entry) => ({
      assetSymbol: entry.assetSymbol,
      quantity: "1",
      locationQuantities: {
        exchange: "1",
        "cold-wallet": "0",
        "cold-wallet-earn": "0",
      },
      averageCost: "1",
      costBasis: "1",
      realizedPnl: "0",
      giftIncome: "0",
      currency: "USDT",
      marketValue: entry.marketValue,
    })),
    valuation: {
      currency: "USDT",
      pricedAssetMarketValue,
      totalAssetValue: add(pricedAssetMarketValue, cashBalance),
      complete: true,
      missingPriceAssets: [],
      excludedCurrencyAssets: [],
      selectedPricesByAsset,
    },
    issues: [],
  };
}
