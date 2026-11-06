/**
 * 这个文件管一件事：给来的一笔买卖能不能收进账本。
 * 它不管单个字段怎么读，那在 tradeValidatorReaders.ts；前后对不对得上，那在 tradeValidatorConsistency.ts。
 * 不显然的决定：新的买卖只收 USDT。2026-08-19 定（W14 01B 第 3.1 节）。
 */

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
 * 填一笔交易时，数量乘单价和成交金额允许差多少钱。默认 0.01 USDT。
 *
 * 为什么要允许差一点：0.015 BTC × 61258.60 算出来是 918.879。
 * 交易所页面可能显示 918.88，一分钱以内的出入不该拦住你。
 * （这个理由是猜的，日志里没写。）
 *
 * 为什么是 0.01：2026-06-24 提交 b41af9b 定下的，当时按一美分理解。
 * 日志里没有决策记录，这是猜的，要核。
 *
 * 想换别的数，调用方传 TradeValidationContext.totalValueTolerance。
 */
const DEFAULT_TOTAL_VALUE_TOLERANCE: DecimalString = "0.01";

/** 检查通过的一笔买卖。手续费一定有值，没填的已经补成 "0"；币种一定是 USDT。 */
export type ValidatedTradeDraft = Omit<TradeDraft, "fee" | "currency"> & {
  fee: DecimalString;
  currency: "USDT";
};

/**
 * 检查一笔买卖时一起传进来的那些条件。
 * priorTrades 是账本里已经收下的全部买卖，这里只读不改。
 * 另外几样开关决定查不查持仓、未来日期、手续费币种。
 */
type TradeValidationContext = {
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

/**
 * 检查结果：通过就给出整理好的一笔。
 * 不通过就给出全部错误。
 */
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
 * 检查一笔买卖的函数长什么样。
 * 输入是任意值，因为表单和 JSON 导入在运行时都不可信。
 * 普通的检查失败不抛错，放进结果里返回。
 */
type TradeDraftValidator = (
  input: unknown,
  context: TradeValidationContext,
) => TradeValidationResult;

/**
 * 这个函数回答：这笔买卖能不能收进账本？不能的话错在哪几处？
 * 它查字段、成交金额、手续费、币种、未来日期。
 * 最后查持仓够不够。
 * 举例：买 0.1 BTC、单价 65000、成交 6500、手续费 5 → 答通过。
 * 举例：交易所只有 0.06 BTC，卖 0.1 → 答不通过，`INSUFFICIENT_HOLDINGS`。
 *
 * 为什么新的只收 USDT：账本只有一个 USDT 现金池，币种从 V3 起收紧。
 * 2026-08-19 定（W14 01A 第二节、01B 第 3.1 节）。
 *
 * 出错时不抛错，返回 ok:false 和全部错误。
 * 表单把错误显示在对应格子旁边。
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
