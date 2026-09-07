import type {
  Asset,
  AssetTransfer,
  CashEvent,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
} from "@/core/shared";
import { translateDefault } from "@/ui";

export const SUPPORTED_VALUATION_CURRENCIES = ["USDT"] as const;

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
  activeCashEvents: CashEvent[];
  activeAssetTransfers: AssetTransfer[];
  activePriceSnapshots: PriceSnapshot[];
  futureTrades: Trade[];
  futureCashEvents: CashEvent[];
  futureAssetTransfers: AssetTransfer[];
  futurePriceSnapshots: PriceSnapshot[];
  unsupportedCurrencyAssets: Asset[];
};

export function isSupportedValuationCurrency(
  currency: string,
): currency is (typeof SUPPORTED_VALUATION_CURRENCIES)[number] {
  return currency === "USDT";
}

export function partitionLedgerFactsForToday(
  ledgerData: LedgerData,
  todayKey: string,
): LedgerFactPartition {
  const activeTrades: Trade[] = [];
  const futureTrades: Trade[] = [];
  const activeCashEvents: CashEvent[] = [];
  const futureCashEvents: CashEvent[] = [];
  const activeAssetTransfers: AssetTransfer[] = [];
  const futureAssetTransfers: AssetTransfer[] = [];
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

  for (const cashEvent of ledgerData.cashEvents) {
    (isLedgerFactInFuture(cashEvent.occurredAt, todayKey)
      ? futureCashEvents
      : activeCashEvents
    ).push(cashEvent);
  }

  for (const assetTransfer of ledgerData.assetTransfers) {
    (isLedgerFactInFuture(assetTransfer.occurredAt, todayKey)
      ? futureAssetTransfers
      : activeAssetTransfers
    ).push(assetTransfer);
  }

  return {
    activeTrades,
    activeCashEvents,
    activeAssetTransfers,
    activePriceSnapshots,
    futureTrades,
    futureCashEvents,
    futureAssetTransfers,
    futurePriceSnapshots,
    unsupportedCurrencyAssets: ledgerData.assets.filter(
      (asset) => !isSupportedValuationCurrency(asset.quoteCurrency),
    ),
  };
}

export function resolveAssetBinanceMappingForRuntime(
  asset: Pick<Asset, "symbol" | "binanceMapping">,
): Asset["binanceMapping"] {
  return asset.binanceMapping ? { ...asset.binanceMapping } : null;
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
        message: `${asset.symbol}${translateDefault("policy.compat.unsupportedValuationCurrencyMiddle")}${asset.quoteCurrency}${translateDefault("policy.compat.unsupportedValuationCurrencySuffix")}`,
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: translateDefault("policy.compat.futureTrade"),
      });
    }
  });

  ledgerData.cashEvents.forEach((cashEvent, index) => {
    if (isLedgerFactInFuture(cashEvent.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `cashEvents[${index}].occurredAt`,
        message: translateDefault("policy.compat.futureCashEvent"),
      });
    }
  });

  ledgerData.assetTransfers.forEach((assetTransfer, index) => {
    if (isLedgerFactInFuture(assetTransfer.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `assetTransfers[${index}].occurredAt`,
        message: translateDefault("policy.compat.futureAssetTransfer"),
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: translateDefault("policy.compat.futurePrice"),
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      warnings.push({
        code: "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: translateDefault(
          "policy.compat.legacyApiPriceWithoutProvenance",
        ),
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
        message: `${translateDefault("policy.compat.duplicateDailyBinancePricePrefix")}${firstIndex}${translateDefault("policy.compat.duplicateDailyBinancePriceSuffix")}`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return warnings;
}
