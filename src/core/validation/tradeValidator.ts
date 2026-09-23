import type {
  Asset,
  AssetTransfer,
  DecimalString,
  Trade,
  TradeDraft,
} from "@/core/models";
import { isEqual, isGreaterThan, isZero } from "@/core/shared";
import { isLedgerFactInFuture } from "@/core/shared";
import { isSupportedValuationCurrency } from "@/core/policies";
import {
  validateTotalValueConsistency,
  validateCurrencyConsistency,
  validateHoldingsTimeline,
} from "./tradeValidatorConsistency";
import type { TradeValidationError } from "./tradeValidatorErrors";
import {
  TRADE_VALIDATION_ERROR_CODES,
  createError,
} from "./tradeValidatorErrors";
import {
  readOptionalOccurredTimeZone,
  readRequiredString,
  readOccurredAt,
  readTimePrecision,
  readTradeType,
  readAssetSymbol,
  readPositiveDecimal,
  readNonNegativeFee,
  readOptionalString,
  readOptionalPersistedString,
} from "./tradeValidatorReaders";

/**
 * USD 第一版允许 quantity * price 与 totalValue 相差 1 美分。
 *
 * 调用方可以通过 TradeValidationContext 覆盖该值；Validator 不负责货币换算。
 */
export const DEFAULT_TOTAL_VALUE_TOLERANCE: DecimalString = "0.01";

/**
 * 校验成功后 fee 一定存在；表单或导入数据未提供 fee 时标准化为 "0"。
 */
export type ValidatedTradeDraft = Omit<TradeDraft, "fee" | "currency"> & {
  fee: DecimalString;
  currency: "USDT";
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
  priorAssetTransfers?: readonly AssetTransfer[];
  totalValueTolerance?: DecimalString;
  skipHoldingsTimeline?: boolean;
  todayKey?: string;
  requireSupportedValuationCurrency?: boolean;
  requiredCurrency?: string;
  requireFeeCurrencyMatch?: boolean;
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
  const occurredAt = readOccurredAt(input.occurredAt, errors);
  const timePrecision = readTimePrecision(input.timePrecision, errors);
  const occurredTimeZone = readOptionalOccurredTimeZone(input, errors);
  const type = readTradeType(input.type, errors);
  const assetSymbol = readAssetSymbol(input.assetSymbol, context.assets, errors);
  const quantity = readPositiveDecimal(input.quantity, "quantity", errors);
  const price = readPositiveDecimal(input.price, "price", errors);
  const totalValue = readPositiveDecimal(input.totalValue, "totalValue", errors);
  const currency = readRequiredString(input, "currency", errors);
  const fee = readNonNegativeFee(input.fee, errors);
  const feeCurrency = readOptionalString(input, "feeCurrency", errors);
  const platform = readOptionalPersistedString(input, "platform", errors);
  const feeRuleId = readOptionalPersistedString(input, "feeRuleId", errors);
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

  if (
    type === "buy" &&
    assetSymbol !== undefined &&
    quantity !== undefined &&
    fee !== undefined &&
    !isZero(fee) &&
    feeCurrency === assetSymbol &&
    (isGreaterThan(fee, quantity) || isEqual(fee, quantity))
  ) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.ASSET_FEE_MUST_BE_LESS_THAN_QUANTITY,
        "fee",
        "A buy fee paid in the traded asset must be less than quantity",
      ),
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

  if (currency !== undefined && currency !== "USDT") {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
        "currency",
        "New trade facts must use USDT",
      ),
    );
  }

  if (
    context.requireFeeCurrencyMatch &&
    fee !== undefined &&
    !isZero(fee) &&
    currency !== undefined &&
    (feeCurrency ?? currency) !== currency &&
    !context.assets.some(
      (asset) => asset.symbol === (feeCurrency ?? currency),
    )
  ) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.FEE_CURRENCY_MISMATCH,
        "feeCurrency",
        "A non-zero fee must use USDT or an existing local asset",
      ),
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
        "V5 supports USDT valuation only",
      ),
    );
  }

  if (
    !context.skipHoldingsTimeline &&
    occurredAt !== undefined &&
    type !== undefined &&
    assetSymbol !== undefined &&
    quantity !== undefined &&
    price !== undefined &&
    totalValue !== undefined &&
    timePrecision !== undefined &&
    fee !== undefined &&
    currency === "USDT"
  ) {
    validateHoldingsTimeline(
      {
        id: "candidate-trade",
        occurredAt,
        timePrecision,
        type,
        assetSymbol,
        quantity,
        price,
        totalValue,
        currency,
        fee,
        feeCurrency: feeCurrency ?? currency,
        createdAt: "9999-12-31T23:59:59.999Z",
        updatedAt: "9999-12-31T23:59:59.999Z",
      },
      context.priorTrades,
      context.priorAssetTransfers ?? [],
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
    currency !== "USDT" ||
    fee === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      occurredAt,
      ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
      timePrecision,
      type,
      assetSymbol,
      quantity,
      price,
      totalValue,
      currency,
      fee,
      ...(feeCurrency === undefined ? {} : { feeCurrency }),
      ...(platform === undefined ? {} : { platform }),
      ...(feeRuleId === undefined ? {} : { feeRuleId }),
      ...(note === undefined ? {} : { note }),
      ...(rawText === undefined ? {} : { rawText }),
    },
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
