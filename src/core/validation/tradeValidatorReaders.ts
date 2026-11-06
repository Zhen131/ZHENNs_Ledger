/**
 * 这个文件管从一笔买卖的输入里逐个读出字段。
 * 读不对就记一条错。
 * 它不管字段之间对不对得上，那在 tradeValidatorConsistency.ts。
 * 没有特别的决定。
 */

import type {
  Asset,
  DecimalString,
  TimePrecision,
  TradeType,
} from "@/core/models";
import { isNegative, isPositive } from "@/core/shared";
import { isSupportedTimeZone } from "@/core/shared";
import { isValidISODateOrDateTime } from "./isoDateValidator";
import type { TradeValidationError } from "./tradeValidatorErrors";
import {
  TRADE_VALIDATION_ERROR_CODES,
  invalidDecimalError,
  createError,
} from "./tradeValidatorErrors";

/**
 * 这个函数读出这笔记在哪个地点；没填就算不知道。
 * 举例："Asia/Shanghai" → 答它；"Mars/Base" → 答没有，并记一条错。
 */
export function readOptionalOccurredTimeZone(
  input: Record<string, unknown>,
  errors: TradeValidationError[],
): string | undefined {
  const value = input.occurredTimeZone;
  if (value === undefined) return undefined;
  if (typeof value === "string" && isSupportedTimeZone(value)) return value;
  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "occurredTimeZone",
      "occurredTimeZone must be a runtime-supported IANA time zone",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出一个必填的文字（目前只有币种），不能是空的。
 * 举例："USDT" → 答它；"" → 答没有，并记一条错。
 */
export function readRequiredString(
  input: Record<string, unknown>,
  field: "currency",
  errors: TradeValidationError[],
): string | undefined {
  const value = input[field];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field,
      `${field} must be a non-empty string`,
    ),
  );
  return undefined;
}

/**
 * 这个函数读出这笔发生在哪天（或哪一刻），写法必须合法。
 * 举例："2026-08-20" → 答它；"2026-02-30" → 答没有，并记一条错。
 */
export function readOccurredAt(
  value: unknown,
  errors: TradeValidationError[],
): string | undefined {
  if (isValidISODateOrDateTime(value)) {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "occurredAt",
      "occurredAt must be a valid ISO date or datetime string",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出这笔记到多细：只到天、到分钟、到秒。
 * 举例："minute" → 答它；"hour" → 答没有，并记一条错。
 */
export function readTimePrecision(
  value: unknown,
  errors: TradeValidationError[],
): TimePrecision | undefined {
  if (value === "day" || value === "minute" || value === "second") {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "timePrecision",
      "timePrecision must be day, minute, or second",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出买还是卖。
 * 举例："buy" → 答它；"swap" → 答没有，并记 `INVALID_TRADE_TYPE`。
 */
export function readTradeType(
  value: unknown,
  errors: TradeValidationError[],
): TradeType | undefined {
  if (value === "buy" || value === "sell") {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_TRADE_TYPE,
      "type",
      "type must be buy or sell",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出资产代码，账本里必须已经有这个资产。
 * 举例："BTC" → 答它；账本里没有 "SOL" 时答没有，记 `ASSET_NOT_FOUND`。
 */
export function readAssetSymbol(
  value: unknown,
  assets: readonly Asset[],
  errors: TradeValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    assets.some((asset) => asset.symbol === value)
  ) {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.ASSET_NOT_FOUND,
      "assetSymbol",
      `Unknown asset: ${String(value)}`,
    ),
  );
  return undefined;
}

/**
 * 这个函数读出数量、单价或成交金额，必须是大于 0 的数字。
 * 举例："0.1" → 答它；"0" → 答没有，记 `VALUE_MUST_BE_POSITIVE`。
 */
export function readPositiveDecimal(
  value: unknown,
  field: "quantity" | "price" | "totalValue",
  errors: TradeValidationError[],
): DecimalString | undefined {
  if (typeof value !== "string") {
    errors.push(invalidDecimalError(field));
    return undefined;
  }

  try {
    if (!isPositive(value)) {
      errors.push(
        createError(
          TRADE_VALIDATION_ERROR_CODES.VALUE_MUST_BE_POSITIVE,
          field,
          `${field} must be greater than 0`,
        ),
      );
      return undefined;
    }
  } catch {
    errors.push(invalidDecimalError(field));
    return undefined;
  }

  return value;
}

/**
 * 这个函数读出手续费，可以是 0，不能是负数；没填就当 "0"。
 * 举例：没填 → 答 "0"；"-1" → 答没有，记 `FEE_MUST_BE_NON_NEGATIVE`。
 */
export function readNonNegativeFee(
  value: unknown,
  errors: TradeValidationError[],
): DecimalString | undefined {
  if (value === undefined) {
    return "0";
  }

  if (typeof value !== "string") {
    errors.push(invalidDecimalError("fee"));
    return undefined;
  }

  try {
    if (isNegative(value)) {
      errors.push(
        createError(
          TRADE_VALIDATION_ERROR_CODES.FEE_MUST_BE_NON_NEGATIVE,
          "fee",
          "fee must be greater than or equal to 0",
        ),
      );
      return undefined;
    }
  } catch {
    errors.push(invalidDecimalError("fee"));
    return undefined;
  }

  return value;
}

/**
 * 这个函数读出可以不填的文字：手续费币种、备注、原文。
 * 举例：没填 → 答没有，也不记错；填了数字 5 → 答没有，记一条错。
 */
export function readOptionalString(
  input: Record<string, unknown>,
  field: "feeCurrency" | "note" | "rawText",
  errors: TradeValidationError[],
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field,
      `${field} must be a string when provided`,
    ),
  );
  return undefined;
}

/**
 * 这个函数读出平台或手续费规则编号。
 * 可以不填，但填了就要存进账本。
 * 填了就不能是空的，前后也不能有空格。
 * 举例：" Binance" → 答没有，记一条错；"Binance" → 答它。
 */
export function readOptionalPersistedString(
  input: Record<string, unknown>,
  field: "platform" | "feeRuleId",
  errors: TradeValidationError[],
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value
  ) {
    return value;
  }

  errors.push(
    createError(
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field,
      `${field} must be a non-empty string without surrounding whitespace when provided`,
    ),
  );
  return undefined;
}
