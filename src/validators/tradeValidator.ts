import type {
  Asset,
  DecimalString,
  TimePrecision,
  Trade,
  TradeDraft,
  TradeType,
} from "../models";
import {
  add,
  isGreaterThan,
  isNegative,
  isPositive,
  isWithinTolerance,
  multiply,
  subtract,
} from "../utils/decimalMath";
import {
  compareLedgerFactOrder,
  isLedgerFactInFuture,
} from "../utils/ledgerDate";
import { isSupportedValuationCurrency } from "../policies/ledgerFactPolicy";
import { isValidISODateOrDateTime } from "./isoDateValidator";

/**
 * The first USD version allows quantity * price and totalValue to differ by one cent.
 *
 * Callers can override this value through TradeValidationContext; the validator does not convert currencies.
 */
export const DEFAULT_TOTAL_VALUE_TOLERANCE: DecimalString = "0.01";

/**
 * Stable error codes for UI, import flows, and tests.
 *
 * message is for display or diagnostics only and must not control program branches.
 */
export const TRADE_VALIDATION_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_TRADE_TYPE: "INVALID_TRADE_TYPE",
  ASSET_NOT_FOUND: "ASSET_NOT_FOUND",
  INVALID_DECIMAL: "INVALID_DECIMAL",
  VALUE_MUST_BE_POSITIVE: "VALUE_MUST_BE_POSITIVE",
  FEE_MUST_BE_NON_NEGATIVE: "FEE_MUST_BE_NON_NEGATIVE",
  TOTAL_VALUE_MISMATCH: "TOTAL_VALUE_MISMATCH",
  INSUFFICIENT_HOLDINGS: "INSUFFICIENT_HOLDINGS",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
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

/**
 * After validation, fee always exists; missing form or import fees normalize to "0".
 */
export type ValidatedTradeDraft = Omit<TradeDraft, "fee"> & {
  fee: DecimalString;
};

/**
 * priorTrades contains every trade already accepted by the current ledger.
 *
 * The validator inserts the candidate into the complete timeline to check positions and currencies,
 * but it does not mutate the array.
 */
export type TradeValidationContext = {
  assets: readonly Asset[];
  priorTrades: readonly Trade[];
  totalValueTolerance?: DecimalString;
  skipHoldingsTimeline?: boolean;
  todayKey?: string;
  requireSupportedValuationCurrency?: boolean;
};

export type TradeValidationResult =
  | {
      ok: true;
      value: ValidatedTradeDraft;
    }
  | {
      ok: false;
      errors: TradeValidationError[];
    };

/**
 * Public function contract for tradeValidator.
 *
 * Input is unknown because form and JSON import data are untrusted at runtime.
 * validateTradeDraft satisfies this signature and returns a structured result;
 * ordinary validation failures are not expressed by throwing.
 */
export type TradeDraftValidator = (
  input: unknown,
  context: TradeValidationContext,
) => TradeValidationResult;

/**
 * Validates an untrusted trade draft from a form or import flow.
 *
 * Currently covers base fields, total-value tolerance, and sell-position rules.
 */
export const validateTradeDraft: TradeDraftValidator = (input, context) => {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError(
          TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
          "input",
          "Trade draft must be an object",
        ),
      ],
    };
  }

  const errors: TradeValidationError[] = [];
  const occurredAt = readOccurredAt(input.occurredAt, errors);
  const timePrecision = readTimePrecision(input.timePrecision, errors);
  const type = readTradeType(input.type, errors);
  const assetSymbol = readAssetSymbol(input.assetSymbol, context.assets, errors);
  const quantity = readPositiveDecimal(input.quantity, "quantity", errors);
  const price = readPositiveDecimal(input.price, "price", errors);
  const totalValue = readPositiveDecimal(input.totalValue, "totalValue", errors);
  const currency = readRequiredString(input, "currency", errors);
  const fee = readNonNegativeFee(input.fee, errors);
  const feeCurrency = readOptionalString(input, "feeCurrency", errors);
  const feeRuleId = readOptionalString(input, "feeRuleId", errors);
  const note = readOptionalString(input, "note", errors);
  const rawText = readOptionalString(input, "rawText", errors);

  if (
    quantity !== undefined &&
    price !== undefined &&
    totalValue !== undefined
  ) {
    validateTotalValueConsistency(
      quantity,
      price,
      totalValue,
      context.totalValueTolerance ?? DEFAULT_TOTAL_VALUE_TOLERANCE,
      errors,
    );
  }

  if (assetSymbol !== undefined && currency !== undefined) {
    validateCurrencyConsistency(
      assetSymbol,
      currency,
      context.assets,
      context.priorTrades,
      errors,
    );
  }

  if (
    occurredAt !== undefined &&
    context.todayKey !== undefined &&
    isLedgerFactInFuture(occurredAt, context.todayKey)
  ) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.FUTURE_FACT,
        "occurredAt",
        `occurredAt cannot be later than ${context.todayKey}`,
      ),
    );
  }

  if (
    context.requireSupportedValuationCurrency &&
    currency !== undefined &&
    !isSupportedValuationCurrency(currency) &&
    context.assets.find((asset) => asset.symbol === assetSymbol)
      ?.quoteCurrency === currency
  ) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.UNSUPPORTED_VALUATION_CURRENCY,
        "currency",
        "Only USD/USDT valuation is supported",
      ),
    );
  }

  if (
    !context.skipHoldingsTimeline &&
    occurredAt !== undefined &&
    type !== undefined &&
    assetSymbol !== undefined &&
    quantity !== undefined &&
    currency !== undefined
  ) {
    validateHoldingsTimeline(
      {
        occurredAt,
        type,
        assetSymbol,
        quantity,
        currency,
      },
      context.priorTrades,
      errors,
    );
  }

  if (
    errors.length > 0 ||
    occurredAt === undefined ||
    timePrecision === undefined ||
    type === undefined ||
    assetSymbol === undefined ||
    quantity === undefined ||
    price === undefined ||
    totalValue === undefined ||
    currency === undefined ||
    fee === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      occurredAt,
      timePrecision,
      type,
      assetSymbol,
      quantity,
      price,
      totalValue,
      currency,
      fee,
      ...(feeCurrency === undefined ? {} : { feeCurrency }),
      ...(feeRuleId === undefined ? {} : { feeRuleId }),
      ...(note === undefined ? {} : { note }),
      ...(rawText === undefined ? {} : { rawText }),
    },
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
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

function readOccurredAt(
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

function readTimePrecision(
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

function readTradeType(
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

function readAssetSymbol(
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

function readPositiveDecimal(
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

function readNonNegativeFee(
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

function readOptionalString(
  input: Record<string, unknown>,
  field: "feeCurrency" | "feeRuleId" | "note" | "rawText",
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

function validateTotalValueConsistency(
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

function validateCurrencyConsistency(
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

type HoldingsTimelineEntry = Pick<
  Trade,
  "occurredAt" | "type" | "assetSymbol" | "quantity" | "currency"
> & {
  originalIndex: number;
};

/**
 * Checks only the quantity timeline after adding the candidate trade. It does not create a Position
 * or calculate cost or profit and loss.
 *
 * Sorting matches positionCalculator: first by occurredAt, then by original array index as a stable
 * order for identical times. The reducer will append the candidate, so it follows all existing trades
 * at the same time.
 */
function validateHoldingsTimeline(
  candidate: Omit<HoldingsTimelineEntry, "originalIndex">,
  priorTrades: readonly Trade[],
  errors: TradeValidationError[],
): void {
  const timeline: HoldingsTimelineEntry[] = priorTrades
    .map((trade, originalIndex) => ({
      occurredAt: trade.occurredAt,
      type: trade.type,
      assetSymbol: trade.assetSymbol,
      quantity: trade.quantity,
      currency: trade.currency,
      originalIndex,
    }))
    .filter((trade) => trade.assetSymbol === candidate.assetSymbol);

  timeline.push({
    ...candidate,
    originalIndex: priorTrades.length,
  });

  timeline.sort((left, right) =>
    compareLedgerFactOrder(
      left.occurredAt,
      right.occurredAt,
      left.originalIndex,
      right.originalIndex,
    ),
  );

  let availableQuantity: DecimalString = "0";

  for (const trade of timeline) {
    if (trade.type === "buy") {
      availableQuantity = add(availableQuantity, trade.quantity);
      continue;
    }

    if (isGreaterThan(trade.quantity, availableQuantity)) {
      errors.push(
        createError(
          TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
          "quantity",
          `Adding this trade would make the ${candidate.assetSymbol} holdings timeline negative`,
        ),
      );
      return;
    }

    availableQuantity = subtract(availableQuantity, trade.quantity);
  }
}

function invalidDecimalError(
  field: "quantity" | "price" | "totalValue" | "fee",
): TradeValidationError {
  return createError(
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    field,
    `${field} must be a valid finite decimal string`,
  );
}

function createError(
  code: TradeValidationErrorCode,
  field: TradeValidationField,
  message: string,
): TradeValidationError {
  return { code, field, message };
}
