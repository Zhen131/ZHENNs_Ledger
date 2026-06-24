import type {
  Asset,
  DecimalString,
  TimePrecision,
  Trade,
  TradeDraft,
  TradeType,
} from "../models";
import { isNegative, isPositive } from "../utils/decimalMath";

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
} as const;

export type TradeValidationErrorCode =
  (typeof TRADE_VALIDATION_ERROR_CODES)[keyof typeof TRADE_VALIDATION_ERROR_CODES];

export type TradeValidationField = "input" | keyof TradeDraft;

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
 * priorTrades 只包含待校验交易之前已经接受的历史交易。
 *
 * Validator 后续使用它判断卖出时的可用持仓，但不会修改该数组。
 */
export type TradeValidationContext = {
  assets: readonly Asset[];
  priorTrades: readonly Trade[];
  totalValueTolerance?: DecimalString;
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
 * Step 3 起实现 validateTradeDraft 时，应满足该签名并返回结构化结果，
 * 普通校验失败不应通过 throw 表达。
 */
export type TradeDraftValidator = (
  input: unknown,
  context: TradeValidationContext,
) => TradeValidationResult;

/**
 * 校验来自表单或导入流程的不可信交易草稿。
 *
 * Step 3 只处理基础字段规则；成交金额误差和超卖规则会在后续步骤加入。
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
