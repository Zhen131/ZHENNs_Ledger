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

/**
 * USD 第一版允许 quantity * price 与 totalValue 相差 1 美分。
 *
 * 调用方可以通过 TradeValidationContext 覆盖该值；Validator 不负责货币换算。
 */
export const DEFAULT_TOTAL_VALUE_TOLERANCE: DecimalString = "0.01";

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
  TOTAL_VALUE_MISMATCH: "TOTAL_VALUE_MISMATCH",
  INSUFFICIENT_HOLDINGS: "INSUFFICIENT_HOLDINGS",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
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
 * 校验成功后 fee 一定存在；表单或导入数据未提供 fee 时标准化为 "0"。
 */
export type ValidatedTradeDraft = Omit<TradeDraft, "fee"> & {
  fee: DecimalString;
};

/**
 * priorTrades 包含当前账本已经接受的全部交易。
 *
 * Validator 会把候选交易插入完整时间线后检查持仓和币种，
 * 但不会修改该数组。
 */
export type TradeValidationContext = {
  assets: readonly Asset[];
  priorTrades: readonly Trade[];
  totalValueTolerance?: DecimalString;
  skipHoldingsTimeline?: boolean;
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
 * tradeValidator 的公开函数契约。
 *
 * 输入使用 unknown，因为表单和 JSON 导入在运行时都不可信。
 * validateTradeDraft 满足该签名并返回结构化结果，普通校验失败不通过
 * throw 表达。
 */
export type TradeDraftValidator = (
  input: unknown,
  context: TradeValidationContext,
) => TradeValidationResult;

/**
 * 校验来自表单或导入流程的不可信交易草稿。
 *
 * 当前覆盖基础字段、成交金额容差和卖出持仓规则。
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
  const occurredAt = readRequiredString(input, "occurredAt", errors);
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
  field: "occurredAt" | "currency",
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
 * 只检查候选交易加入后的数量时间线，不生成 Position，
 * 也不计算成本或盈亏。
 *
 * 排序规则与 positionCalculator 保持一致：先按 occurredAt，再以
 * 原数组序号作为同一时间的稳定顺序。候选交易未来会被
 * reducer 追加，因此同时间下排在所有已有交易之后。
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

  timeline.sort((left, right) => {
    const dateOrder = left.occurredAt.localeCompare(right.occurredAt);
    return dateOrder === 0
      ? left.originalIndex - right.originalIndex
      : dateOrder;
  });

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
