import type { DecimalString, TradeType } from "@/core/models";
import { add, isZero, subtract } from "@/core/shared";

export type TradeCashImpactInput = {
  type: TradeType;
  totalValue: DecimalString;
  currency: string;
  fee: DecimalString;
  feeCurrency: string;
};

export type TradeCashImpactResult =
  | {
      ok: true;
      amount: DecimalString;
      currency: string;
      kind: "buy-outflow" | "sell-proceeds";
    }
  | {
      ok: false;
      reason: "UNSUPPORTED_FEE_CURRENCY";
      feeCurrency: string;
      tradeCurrency: string;
    };

export function calculateTradeCashImpact(
  trade: TradeCashImpactInput,
): TradeCashImpactResult {
  if (!isZero(trade.fee) && trade.feeCurrency !== trade.currency) {
    return {
      ok: false,
      reason: "UNSUPPORTED_FEE_CURRENCY",
      feeCurrency: trade.feeCurrency,
      tradeCurrency: trade.currency,
    };
  }

  return {
    ok: true,
    amount:
      trade.type === "buy"
        ? add(trade.totalValue, trade.fee)
        : subtract(trade.totalValue, trade.fee),
    currency: trade.currency,
    kind: trade.type === "buy" ? "buy-outflow" : "sell-proceeds",
  };
}
