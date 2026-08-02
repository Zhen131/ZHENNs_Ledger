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
        message: "Only USD/USDT valuation is currently supported",
      });
    }
  });

  ledgerData.trades.forEach((trade, index) => {
    if (isLedgerFactInFuture(trade.occurredAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `trades[${index}].occurredAt`,
        message: `Trade date ${getLedgerDateKey(trade.occurredAt)} is later than today ${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(trade.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `trades[${index}].currency`,
        message: "Only USD/USDT valuation is currently supported",
      });
    }
  });

  const firstDailyBinanceIndex = new Map<string, number>();
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (isLedgerFactInFuture(snapshot.recordedAt, todayKey)) {
      errors.push({
        code: "LEDGER_IMPORT_FUTURE_FACT",
        path: `priceSnapshots[${index}].recordedAt`,
        message: `Price date ${getLedgerDateKey(snapshot.recordedAt)} is later than today ${todayKey}`,
      });
    }
    if (!isSupportedValuationCurrency(snapshot.currency)) {
      errors.push({
        code: "LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY",
        path: `priceSnapshots[${index}].currency`,
        message: "Only USD/USDT valuation is currently supported",
      });
    }

    if (snapshot.source === "api" && !snapshot.binanceProvenance) {
      errors.push({
        code: "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED",
        path: `priceSnapshots[${index}].binanceProvenance`,
        message: "Newly imported API prices must preserve Binance source evidence",
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
        message: `Duplicate Binance price for the same day; first seen at priceSnapshots[${firstIndex}]`,
      });
    } else {
      firstDailyBinanceIndex.set(key, index);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
