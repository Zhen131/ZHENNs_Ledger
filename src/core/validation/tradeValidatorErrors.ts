import type { TradeDraft } from "@/core/models";

/**
 * 稳定错误码供 UI、导入流程和测试判断。
 *
 * message 只用于展示或诊断，不应作为程序分支条件。
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

export type TradeValidationErrorCode =
  (typeof TRADE_VALIDATION_ERROR_CODES)[keyof typeof TRADE_VALIDATION_ERROR_CODES];

export type TradeValidationField =
  | "input"
  | "totalValueTolerance"
  | keyof TradeDraft;

export type TradeValidationError = {
  code: TradeValidationErrorCode;
  field: TradeValidationField;
  message: string;
};

export function invalidDecimalError(
  field: "quantity" | "price" | "totalValue" | "fee",
): TradeValidationError {
  return createError(
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    field,
    `${field} must be a valid finite decimal string`,
  );
}

export function createError(
  code: TradeValidationErrorCode,
  field: TradeValidationField,
  message: string,
): TradeValidationError {
  return { code, field, message };
}
