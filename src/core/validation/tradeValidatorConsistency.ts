/**
 * 这个文件管一笔买卖前后对不对得上。
 * 查三项：金额、币种、持仓够不够。
 * 它不管单个字段读得对不对，那在 tradeValidatorReaders.ts。
 * 不显然的决定：持仓够不够直接拿 replayPositions 算，不另写一套。这是猜的，日志里没写，要核。
 */

import type { Asset, AssetTransfer, DecimalString, Trade } from "@/core/models";
import { replayPositions } from "@/core/calculations";
import { isWithinTolerance, multiply } from "@/core/shared";
import type { TradeValidationError } from "./tradeValidatorErrors";
import {
  TRADE_VALIDATION_ERROR_CODES,
  createError,
} from "./tradeValidatorErrors";

/**
 * 这个函数回答：数量乘单价，和填的成交金额差得多不多？
 * 差得超过允许差多少，就记一条 `TOTAL_VALUE_MISMATCH`。
 * 举例：0.015 × 61258.60 = 918.879，填 918.88，允许差 0.01 → 答没问题。
 * 允许差多少不是合法数字时，记一条 `INVALID_DECIMAL`。
 * 不抛错，错误都放进传进来的错误列表。
 */
export function validateTotalValueConsistency(
  quantity: DecimalString,
  price: DecimalString,
  totalValue: DecimalString,
  tolerance: DecimalString,
  errors: TradeValidationError[],
): void {
  try {
    const calculatedTotalValue = multiply(quantity, price);

    if (!isWithinTolerance(calculatedTotalValue, totalValue, tolerance)) {
      errors.push(
        createError(
          TRADE_VALIDATION_ERROR_CODES.TOTAL_VALUE_MISMATCH,
          "totalValue",
          `quantity × price is ${calculatedTotalValue}, but totalValue is ${totalValue}; allowed difference is ${tolerance}`,
        ),
      );
    }
  } catch {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
        "totalValueTolerance",
        "totalValueTolerance must be a valid non-negative finite decimal string",
      ),
    );
  }
}

/**
 * 这个函数回答：这笔的币种和资产、以前的买卖对得上吗？
 * 举例：BTC 的报价币种是 USDT，这笔填 USD → 答对不上，记 `CURRENCY_MISMATCH`。
 * 不抛错，错误放进传进来的错误列表。
 */
export function validateCurrencyConsistency(
  assetSymbol: string,
  currency: string,
  assets: readonly Asset[],
  priorTrades: readonly Trade[],
  errors: TradeValidationError[],
): void {
  const asset = assets.find((item) => item.symbol === assetSymbol);
  const hasPriorCurrencyMismatch = priorTrades.some(
    (trade) =>
      trade.assetSymbol === assetSymbol && trade.currency !== currency,
  );

  if (asset?.quoteCurrency !== currency || hasPriorCurrencyMismatch) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
        "currency",
        `currency must match ${assetSymbol} quote currency and existing trades`,
      ),
    );
  }
}

/**
 * 这个函数回答：把这笔放进全部买卖和转移里，持仓够不够？
 * 举例：交易所里只有 0.06 BTC，这笔卖 0.1 → 答不够，记 `INSUFFICIENT_HOLDINGS`。
 * 从冷钱包转回交易所后再卖，就算得进去。
 *
 * 为什么录入时间填成 9999 年：好让它排在同时刻的旧记录后面。
 * 真正保存时，tradeService 会用最终编号和时间再算一遍。
 * （这是猜的，日志里没写，要核。）
 * 不抛错，算不过时把原因放进错误列表。
 */
export function validateHoldingsTimeline(
  candidate: Trade,
  priorTrades: readonly Trade[],
  priorAssetTransfers: readonly AssetTransfer[],
  errors: TradeValidationError[],
): void {
  try {
    replayPositions([...priorTrades, candidate], priorAssetTransfers);
  } catch (error) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
        "quantity",
        error instanceof Error
          ? error.message
          : `Adding this trade would invalidate the ${candidate.assetSymbol} holdings timeline`,
      ),
    );
  }
}
