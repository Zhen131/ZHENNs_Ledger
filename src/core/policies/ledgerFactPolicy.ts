/**
 * 这个文件管打开旧账本时，哪些记录要提醒、哪些先放一边。
 * 它不拒绝任何账本，拒绝导入的规矩在 ledgerImportPolicy.ts。
 * 不显然的决定：估值币种只认 USDT。2026-08-19 定（W14 01B 第 3.1 节）。
 */

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

/**
 * 能用来估值的币种，目前只有 USDT。
 * 为什么只有它：账本只有一个 USDT 现金池。2026-08-19 定（W14 01A 第二节）。
 */
export const SUPPORTED_VALUATION_CURRENCIES = ["USDT"] as const;

/** 打开账本时给人看的一条提醒：哪类问题、在哪、说明。 */
export type LedgerCompatibilityWarning = {
  code:
    | "LEDGER_FUTURE_FACT"
    | "LEDGER_UNSUPPORTED_VALUATION_CURRENCY"
    | "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE"
    | "LEDGER_DUPLICATE_DAILY_BINANCE_PRICE";
  path: string;
  message: string;
};

type LedgerFactPartition = {
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

/**
 * 这个函数回答：这个币种能不能用来估值？
 * 举例："USDT" → 答能；"USD" → 答不能。
 */
export function isSupportedValuationCurrency(
  currency: string,
): currency is (typeof SUPPORTED_VALUATION_CURRENCIES)[number] {
  return currency === "USDT";
}

/**
 * 这个函数把账本里的记录按「今天」分成两堆。
 * 一堆是今天及以前的，一堆是今天以后的。
 * 它还挑出估值币种不认识的资产。
 * 举例：今天 2026-11-06，一笔买卖记在 11-07 → 答它在「以后的」那堆。
 *
 * 为什么分开：现金和持仓只算今天及以前的记录。
 * 2026-08-19 定（W14 01B 第 3.4 节）。
 * 记录开头不是日期时会抛错。
 */
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

/**
 * 这个函数回答：程序运行时这个资产用哪个交易对取价？没有就答空。
 * 答的是一份复制品，改它不会改到账本。
 * 举例：BTC 映射 BTCUSDT → 答一份新的 BTCUSDT 映射。
 */
export function resolveAssetBinanceMappingForRuntime(
  asset: Pick<Asset, "symbol" | "binanceMapping">,
): Asset["binanceMapping"] {
  return asset.binanceMapping ? { ...asset.binanceMapping } : null;
}

/**
 * 这个函数回答：这本账本打开后，要给人看哪些提醒？
 * 它提醒四类。未来日期、估值币种不认识、行情价没来历。
 * 还有同一天同一交易对出现两条行情价。
 * 举例：同一天 BTCUSDT 有两条行情价 → 答一条重复提醒。
 * 提醒里写着第一条的位置。
 * 只提醒，不改账本，也不抛错。
 */
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
