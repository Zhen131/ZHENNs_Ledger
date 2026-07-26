import type { LedgerData } from "../models";
import { getLedgerDateKey, isLedgerFactInFuture } from "../utils/ledgerDate";
import { isSupportedValuationCurrency } from "./ledgerFactPolicy";

export type LedgerImportPolicyError = {
  code:
    | "LEDGER_IMPORT_FUTURE_FACT"
    | "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY"
    | "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED"
    | "LEDGER_IMPORT_DUPLICATE_DAILY_BINANCE_PRICE";
  path: string;
  message: string;
};

export type LedgerImportPolicyResult =
  | { ok: true }
  | { ok: false; errors: LedgerImportPolicyError[] };

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
        message: "当前仅支持 USD/USDT 估值",
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: `交易日期 ${getLedgerDateKey(trade.occurredAt)} 晚于今天 ${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(trade.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `trades[${index}].currency`,
        message: "当前仅支持 USD/USDT 估值",
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: `价格日期 ${getLedgerDateKey(snapshot.recordedAt)} 晚于今天 ${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(snapshot.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `priceSnapshots[${index}].currency`,
        message: "当前仅支持 USD/USDT 估值",
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      errors.push({
        code: "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: "新导入的 API 价格必须保留 Binance 来源证据",
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
        message: `同日 Binance 价格重复；首次出现在 priceSnapshots[${firstIndex}]`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
