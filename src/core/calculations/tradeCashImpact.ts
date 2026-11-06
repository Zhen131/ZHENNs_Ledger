/**
 * 这个文件管一件事：一笔买卖让钱动多少。
 * 手续费怎么算进去，也在这里定。
 * 它不管持仓数量怎么变，那在 positionReplay.ts；也不管现金怎么一笔笔累加，那在 cashReplay.ts。
 * 不显然的决定：手续费用别的币付时不换算、只做标记。2026-08-09 定（W12 01A 第 6.3 节）。
 */

import type { DecimalString, TradeType } from "@/core/models";
import { add, isZero, subtract } from "@/core/shared";

/**
 * 算一笔买卖的钱要用到的几样。
 * 有方向、资产、成交金额、币种、手续费和手续费币种。
 */
export type TradeCashImpactInput = {
  type: TradeType;
  assetSymbol: string;
  totalValue: DecimalString;
  currency: string;
  fee: DecimalString;
  feeCurrency: string;
};

/**
 * 一笔买卖对钱的影响。
 * 要么算出来了：金额、币种、是花出去还是收进来。
 * 要么因为手续费币种不认识而算不出来。
 */
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

/**
 * 这个函数回答：这一笔买卖算成本和盈亏时，钱是多少？
 * 举例：买 0.1 BTC，成交 6500，手续费 5 USDT → 答「花出去 6505」。
 * 举例：卖 0.04 BTC，成交 2800，手续费 3 USDT → 答「收进来 2797」。
 * 手续费用买卖的那个币付时，钱不加不减，原样返回成交金额。
 * 少到手的币由 positionReplay 去扣。
 *
 * 为什么别的币付的手续费不换算：宁可标出来，也不乱算。
 * 2026-08-09 定（W12 01A 第 6.3 节）。
 *
 * 出错时不抛错，返回 ok:false。
 * 调用方把这笔标成「手续费算不进来」，账本照常打开。
 */
export function calculateTradeCashImpact(
  trade: TradeCashImpactInput,
): TradeCashImpactResult {
  const feeUsesTradeAsset =
    !isZero(trade.fee) && trade.feeCurrency === trade.assetSymbol;

  if (
    !isZero(trade.fee) &&
    trade.feeCurrency !== trade.currency &&
    !feeUsesTradeAsset
  ) {
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
      feeUsesTradeAsset
        ? trade.totalValue
        : trade.type === "buy"
          ? add(trade.totalValue, trade.fee)
          : subtract(trade.totalValue, trade.fee),
    currency: trade.currency,
    kind: trade.type === "buy" ? "buy-outflow" : "sell-proceeds",
  };
}

/**
 * 这个函数回答：这笔买卖让 USDT 现金变了多少？
 * 花出去是负数，收进来是正数。
 * 举例：买入成交 6500，手续费 5 USDT → 答 "-6505"。
 * 举例：卖出成交 2800，手续费 3 BNB → 答 "2800"。
 *
 * 为什么只有 USDT 手续费动现金：别的币付的不扣 USDT。
 * 也不换算。
 * 2026-08-19 定（W14 01B 第 3.3 节）。
 * 不会出错。
 */
export function calculateTradeUsdtCashDelta(
  trade: Pick<
    TradeCashImpactInput,
    "type" | "totalValue" | "fee" | "feeCurrency"
  >,
): DecimalString {
  const feeAffectsUsdt = !isZero(trade.fee) && trade.feeCurrency === "USDT";
  const amount = feeAffectsUsdt
    ? trade.type === "buy"
      ? add(trade.totalValue, trade.fee)
      : subtract(trade.totalValue, trade.fee)
    : trade.totalValue;

  return trade.type === "buy" ? subtract("0", amount) : amount;
}
