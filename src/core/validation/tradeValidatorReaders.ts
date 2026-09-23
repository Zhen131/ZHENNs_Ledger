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
