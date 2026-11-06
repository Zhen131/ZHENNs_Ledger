/**
 * 这个文件管导入一本账本时，额外要拦下的几种情况。
 * 它不管结构对不对，那在 validation 区；也不管打开时的提醒，那在 ledgerFactPolicy.ts。
 * 不显然的决定：导入时有未来日期的记录就拒绝。2026-08-19 定（W14 01B 第 3.4 节）。
 */

import type { LedgerData } from "@/core/models";
import { getLedgerDateKey, isLedgerFactInFuture } from "@/core/shared";
import { translateDefault } from "@/ui";
import { isSupportedValuationCurrency } from "./ledgerFactPolicy";

/** 导入被拦下时的一条错误：哪类问题、在哪、说明。 */
export type LedgerImportPolicyError = {
  code:
    | "LEDGER_IMPORT_FUTURE_FACT"
    | "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY"
    | "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED"
    | "LEDGER_IMPORT_DUPLICATE_DAILY_BINANCE_PRICE";
  path: string;
  message: string;
};

type LedgerImportPolicyResult =
  | { ok: true }
  | { ok: false; errors: LedgerImportPolicyError[] };

/**
 * 这个函数回答：这本账本能不能导入？
 * 它拦四类。未来日期、估值币种不是 USDT、行情价没来历。
 * 还有同一天同一交易对出现两条行情价。
 * 举例：今天 2026-11-06，一笔入金记在 11-08 → 答不能，`LEDGER_IMPORT_FUTURE_FACT`。
 *
 * 为什么同一天的行情价只许一条：这是猜的，日志里没写，要核。
 *
 * 出错时不抛错，返回 ok:false 和全部错误；导入就此停下。
 */
export function validateLedgerImportPolicy(
  ledgerData: LedgerData,
  todayKey: string,
): LedgerImportPolicyResult {
  const errors: LedgerImportPolicyError[] = [];

  ledgerData.assets.forEach((asset, index) => {
    if (!isSupportedValuationCurrency(asset.quoteCurrency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `assets[${index}].quoteCurrency`,
        message: translateDefault("policy.import.unsupportedValuationCurrency"),
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: `${translateDefault("policy.import.futureTradePrefix")}${getLedgerDateKey(trade.occurredAt)}${translateDefault("policy.import.futureFactMiddle")}${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(trade.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `trades[${index}].currency`,
        message: translateDefault("policy.import.unsupportedValuationCurrency"),
      });
    }
  });

  ledgerData.cashEvents.forEach((cashEvent, index) => {
    if (isLedgerFactInFuture(cashEvent.occurredAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `cashEvents[${index}].occurredAt`,
        message: `${translateDefault("policy.import.futureCashEventPrefix")}${getLedgerDateKey(cashEvent.occurredAt)}${translateDefault("policy.import.futureFactMiddle")}${todayKey}`,
      });
    }
  });

  ledgerData.assetTransfers.forEach((assetTransfer, index) => {
    if (isLedgerFactInFuture(assetTransfer.occurredAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `assetTransfers[${index}].occurredAt`,
        message: `${translateDefault("policy.import.futureAssetTransferPrefix")}${getLedgerDateKey(assetTransfer.occurredAt)}${translateDefault("policy.import.futureFactMiddle")}${todayKey}`,
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: `${translateDefault("policy.import.futurePricePrefix")}${getLedgerDateKey(snapshot.recordedAt)}${translateDefault("policy.import.futureFactMiddle")}${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(snapshot.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `priceSnapshots[${index}].currency`,
        message: translateDefault("policy.import.unsupportedValuationCurrency"),
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      errors.push({
        code: "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: translateDefault("policy.import.apiPriceProvenanceRequired"),
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
      errors.push({
        code: "LEDGER_IMPORT_DUPLICATE_DAILY_BINANCE_PRICE",
        path: `priceSnapshots[${index}]`,
        message: `${translateDefault("policy.import.duplicateDailyBinancePricePrefix")}${firstIndex}${translateDefault("policy.import.duplicateDailyBinancePriceSuffix")}`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
