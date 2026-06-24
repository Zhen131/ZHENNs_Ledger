import type {
  Asset,
  DecimalString,
  Trade,
  TradeDraft,
} from "../models";

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
