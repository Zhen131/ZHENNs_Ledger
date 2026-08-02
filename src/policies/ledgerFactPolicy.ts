import type {
  Asset,
  BinanceMarketMapping,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "../models";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
} from "../utils/ledgerDate";

export const SUPPORTED_VALUATION_CURRENCIES = ["USD", "USDT"] as const;

export type LedgerCompatibilityWarning = {
  code:
    | "LEDGER_FUTURE_FACT"
    | "LEDGER_UNSUPPORTED_VALUATION_CURRENCY"
    | "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE"
    | "LEDGER_DUPLICATE_DAILY_BINANCE_PRICE";
  path: string;
  message: string;
};

export type LedgerFactPartition = {
  activeTrades: Trade[];
  activePriceSnapshots: PriceSnapshot[];
  futureTrades: Trade[];
  futurePriceSnapshots: PriceSnapshot[];
  unsupportedCurrencyAssets: Asset[];
};

const DEFAULT_BINANCE_MAPPINGS: Readonly<
  Record<string, BinanceMarketMapping>
> = {
  BTC: {
    provider: "binance",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
  },
  ETH: {
    provider: "binance",
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
  },
  ADA: {
    provider: "binance",
    symbol: "ADAUSDT",
    baseAsset: "ADA",
    quoteAsset: "USDT",
  },
};

export function isSupportedValuationCurrency(
  currency: string,
): currency is (typeof SUPPORTED_VALUATION_CURRENCIES)[number] {
  return currency === "USD" || currency === "USDT";
}

export function partitionLedgerFactsForToday(
  ledgerData: LedgerData,
  todayKey: string,
): LedgerFactPartition {
  const activeTrades: Trade[] = [];
  const futureTrades: Trade[] = [];
  const activePriceSnapshots: PriceSnapshot[] = [];
  const futurePriceSnapshots: PriceSnapshot[] = [];

  for (const trade of ledgerData.trades) {
    (isLedgerFactInFuture(trade.occurredAt, todayKey)
      ? futureTrades
      : activeTrades
    ).push(trade);
  }

  for (const snapshot of ledgerData.priceSnapshots) {
    (isLedgerFactInFuture(snapshot.recordedAt, todayKey)
      ? futurePriceSnapshots
      : activePriceSnapshots
    ).push(snapshot);
  }

  return {
    activeTrades,
    activePriceSnapshots,
    futureTrades,
    futurePriceSnapshots,
    unsupportedCurrencyAssets: ledgerData.assets.filter(
      (asset) => !isSupportedValuationCurrency(asset.quoteCurrency),
    ),
  };
}

export function normalizeLedgerDataForRuntime(
  ledgerData: LedgerData,
): LedgerData {
  let changed = false;
  const assets = ledgerData.assets.map((asset) => {
    const defaultMapping = DEFAULT_BINANCE_MAPPINGS[asset.symbol];
    if (asset.binanceMapping !== undefined || defaultMapping === undefined) {
      return asset;
    }

    changed = true;
    return {
      ...asset,
      binanceMapping: { ...defaultMapping },
    };
  });

  return changed ? { ...ledgerData, assets } : ledgerData;
}

export function collectLedgerCompatibilityWarnings(
  ledgerData: LedgerData,
  todayKey: string,
): LedgerCompatibilityWarning[] {
  const warnings: LedgerCompatibilityWarning[] = [];

  ledgerData.assets.forEach((asset, index) => {
    if (!isSupportedValuationCurrency(asset.quoteCurrency)) {
      warnings.push({
        code: "LEDGER_UNSUPPORTED_VALUATION_CURRENCY",
        path: `assets[${index}].quoteCurrency`,
        message: `${asset.symbol} quoted in ${asset.quoteCurrency} is excluded from USD-equivalent valuation`,
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: "A future trade is isolated; delete it, replace the ledger, or clear the ledger before normal writes can resume",
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: "A future price is isolated; delete it, replace the ledger, or clear the ledger before normal writes can resume",
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      warnings.push({
        code: "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: "A legacy API price lacks source evidence; it is visible for rescue only and excluded from Binance valuation",
      });
      return;
    }

    if (!snapshot.binanceProvenance) {
      return;
    }

    const key = [
      snapshot.binanceProvenance.provider,
      snapshot.binanceProvenance.symbol,
      getLedgerDateKey(snapshot.recordedAt),
    ].join(":");
    const firstIndex = firstDailyBinanceIndex.get(key);
    if (firstIndex !== undefined) {
      warnings.push({
        code: "LEDGER_DUPLICATE_DAILY_BINANCE_PRICE",
        path: `priceSnapshots[${index}]`,
        message: `Duplicate Binance price for the same day; first seen at priceSnapshots[${firstIndex}]`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return warnings;
}
