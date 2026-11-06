/**
 * 这个文件管检查一笔买卖时用到的错误代码和错误的样子。
 * 它不管怎么检查，那在 tradeValidator.ts 和几份读字段的文件里。
 * 没有特别的决定。
 */

import type { TradeDraft } from "@/core/models";

/**
 * 检查一笔买卖时可能报的错误代码，名字固定不变。
 * 界面、导入和测试都按代码判断，不按文字判断。
 * 为什么固定：文字只给人看，改了文字不该改程序走哪条路。这是猜的，日志里没写，要核。
 */
export const TRADE_VALIDATION_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_TRADE_TYPE: "INVALID_TRADE_TYPE",
  ASSET_NOT_FOUND: "ASSET_NOT_FOUND",
  INVALID_DECIMAL: "INVALID_DECIMAL",
  VALUE_MUST_BE_POSITIVE: "VALUE_MUST_BE_POSITIVE",
  FEE_MUST_BE_NON_NEGATIVE: "FEE_MUST_BE_NON_NEGATIVE",
  ASSET_FEE_MUST_BE_LESS_THAN_QUANTITY:
    "ASSET_FEE_MUST_BE_LESS_THAN_QUANTITY",
  TOTAL_VALUE_MISMATCH: "TOTAL_VALUE_MISMATCH",
  INSUFFICIENT_HOLDINGS: "INSUFFICIENT_HOLDINGS",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  FEE_CURRENCY_MISMATCH: "FEE_CURRENCY_MISMATCH",
  NEW_FACT_REQUIRES_USDT: "NEW_FACT_REQUIRES_USDT",
  FUTURE_FACT: "FUTURE_FACT",
  UNSUPPORTED_VALUATION_CURRENCY: "UNSUPPORTED_VALUATION_CURRENCY",
} as const;

/** 上面那张表里任意一个错误代码。 */
export type TradeValidationErrorCode =
  (typeof TRADE_VALIDATION_ERROR_CODES)[keyof typeof TRADE_VALIDATION_ERROR_CODES];

/**
 * 出错的是哪个格子。
 * 可能是整个输入、允许差多少，或一笔买卖的某个字段。
 */
export type TradeValidationField =
  | "input"
  | "totalValueTolerance"
  | keyof TradeDraft;

/** 一条检查错误：错误代码、哪个格子、给人看的说明。 */
export type TradeValidationError = {
  code: TradeValidationErrorCode;
  field: TradeValidationField;
  message: string;
};

/**
 * 这个函数做一条「这不是一个合法数字」的错误。
 * 举例：传 "price" → 答代码 `INVALID_DECIMAL`、格子 price 的错误。
 */
export function invalidDecimalError(
  field: "quantity" | "price" | "totalValue" | "fee",
): TradeValidationError {
  return createError(
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    field,
    `${field} must be a valid finite decimal string`,
  );
}

/**
 * 这个函数把错误代码、格子、说明三样拼成一条错误。
 * 举例：传 `FUTURE_FACT`、occurredAt、说明 → 答一条错误。
 */
export function createError(
  code: TradeValidationErrorCode,
  field: TradeValidationField,
  message: string,
): TradeValidationError {
  return { code, field, message };
}
