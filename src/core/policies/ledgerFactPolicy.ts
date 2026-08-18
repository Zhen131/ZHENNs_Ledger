import type {
  Asset,
  CashEvent,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
} from "@/core/shared";

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
  activePriceSnapshots: PriceSnapshot[];
  futureTrades: Trade[];
  futureCashEvents: CashEvent[];
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

  return {
    activeTrades,
    activeCashEvents,
    activePriceSnapshots,
    futureTrades,
    futureCashEvents,
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
        message: `${asset.symbol} 的 ${asset.quoteCurrency} 不进入 USD 等值估值`,
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: "未来交易已隔离，必须删除、替换账本或清空后才能恢复普通写入",
      });
    }
  });

  ledgerData.cashEvents.forEach((cashEvent, index) => {
    if (isLedgerFactInFuture(cashEvent.occurredAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `cashEvents[${index}].occurredAt`,
        message:
          "未来现金事件已隔离，必须删除、替换账本或清空后才能恢复普通写入",
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      warnings.push({
        code: "LEDGER_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: "未来价格已隔离，必须删除、替换账本或清空后才能恢复普通写入",
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      warnings.push({
        code: "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: "旧 API 价格缺少来源证据，仅供救援查看，不参加 Binance 估值",
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
        message: `同日 Binance 价格重复；首次出现在 priceSnapshots[${firstIndex}]`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return warnings;
}
