/**
 * 这个文件放交易表单用的几个小函数。
 * 它们管错误说明、成交金额、现金预览、选中的规则。
 * 按钮按下后做什么在 `tradeFormActions.ts`。
 * 没有特别的决定。
 */
import type { TradeDraft } from "@/core/models";
import { calculateTradeUsdtCashDelta } from "@/core/calculations";
import { matchFeeRules, type FeeRuleCandidate } from "@/features/fees";
import type {
  TradeValidationError,
  TradeValidationField,
} from "@/core/validation";
import { absolute, add, isNegative, multiply } from "@/core/shared";
import type { TranslationKey, Translate } from "@/ui";
import type { TradeFormState, TradeFormField } from "./tradeFormTypes";


const fieldLabelKeys: Record<keyof TradeDraft, TranslationKey> = {
  occurredAt: "trades.form.field.date",
  occurredTimeZone: "trades.form.field.timeZone",
  timePrecision: "trades.form.field.timePrecision",
  type: "trades.form.field.type",
  assetSymbol: "trades.form.field.asset",
  quantity: "trades.form.field.quantity",
  price: "trades.form.field.averagePrice",
  totalValue: "trades.form.field.totalValue",
  currency: "trades.form.field.currency",
  fee: "trades.form.field.actualFee",
  feeCurrency: "trades.form.field.feeCurrency",
  platform: "trades.form.field.platform",
  feeRuleId: "trades.form.field.feeRule",
  note: "trades.form.field.note",
  rawText: "trades.form.field.rawText",
};

/**
 * 这个函数回答：一条检查错误在界面上怎么说？
 * 按错误代码挑一句话，必要时在前面加上那一栏的名字。
 * 举例：数量写成「abc」→ 答「数量必须是数字」（按当前语言）。
 * 不会出错。
 */
export function formatValidationError(
  error: TradeValidationError,
  t: Translate,
): string {
  const label =
    error.field === "input" || error.field === "totalValueTolerance"
      ? t("trades.form.field.trade")
      : t(fieldLabelKeys[error.field]);

  switch (error.code) {
    case "INVALID_TRADE_TYPE":
      return t("trades.form.error.invalidType");
    case "ASSET_NOT_FOUND":
      return t("trades.form.error.assetNotFound");
    case "INVALID_DECIMAL":
      return `${label}${t("trades.form.error.mustBeNumber")}`;
    case "VALUE_MUST_BE_POSITIVE":
      return `${label}${t("trades.form.error.mustBePositive")}`;
    case "FEE_MUST_BE_NON_NEGATIVE":
      return t("trades.form.error.feeNonNegative");
    case "ASSET_FEE_MUST_BE_LESS_THAN_QUANTITY":
      return t("trades.form.error.assetFeeLessThanQuantity");
    case "TOTAL_VALUE_MISMATCH":
      return t("trades.form.error.totalValueMismatch");
    case "INSUFFICIENT_HOLDINGS":
      return t("trades.form.error.insufficientHoldings");
    case "CURRENCY_MISMATCH":
      return t("trades.form.error.currencyMismatch");
    case "FEE_CURRENCY_MISMATCH":
      return t("trades.form.error.feeCurrencyMismatch");
    case "NEW_FACT_REQUIRES_USDT":
      return t("trades.form.error.newFactRequiresUsdt");
    case "FUTURE_FACT":
      return t("trades.form.error.futureFact");
    case "UNSUPPORTED_VALUATION_CURRENCY":
      return t("trades.form.error.unsupportedValuationCurrency");
    case "INVALID_INPUT":
      return `${label}${t("trades.form.error.invalidInput")}`;
  }
}

/**
 * 这个函数回答：一条检查错误该显示在表单哪一栏旁边？
 * 表单上没有那一栏的，都显示在整个表单的顶上。
 * 举例：`feeCurrency` 出错 → 答 `form`。
 * 不会出错。
 */
export function toTradeFormField(field: TradeValidationField): TradeFormField {
  switch (field) {
    case "type":
    case "assetSymbol":
    case "quantity":
    case "price":
    case "totalValue":
    case "occurredAt":
    case "occurredTimeZone":
    case "fee":
    case "note":
      return field;
    case "input":
    case "totalValueTolerance":
    case "timePrecision":
    case "currency":
    case "feeCurrency":
    case "platform":
    case "feeRuleId":
    case "rawText":
      return "form";
  }
}

/**
 * 这个函数回答：数量乘单价，自动成交金额是多少？
 * 举例：数量 0.1，单价 65000 → 答「6500」。
 * 有一栏空着或写得不是数，返回空字符串。
 * 不会出错。
 */
export function calculateAutomaticTotal(quantity: string, price: string): string {
  if (quantity === "" || price === "") return "";
  try {
    return multiply(quantity, price);
  } catch {
    return "";
  }
}

/**
 * 这个函数回答：这笔买卖存了以后，USDT 余额会变成多少？
 * 举例：余额 10000，买入成交 6500、手续费 5 USDT。
 * → 答变化 -6505，存后 3495，缺口 0。
 * 成交金额、手续费、手续费币种有一个空着，返回空。
 * 数字写错算不出来，也返回空，不抛错。
 */
export function getCashImpactPreview(
  form: TradeFormState,
  feeCurrency: string,
  currentBalance: string,
) {
  if (!form.totalValue || !form.fee || !feeCurrency) {
    return undefined;
  }
  try {
    const delta = calculateTradeUsdtCashDelta({
      type: form.type,
      totalValue: form.totalValue,
      fee: form.fee,
      feeCurrency,
    });
    const nextBalance = add(currentBalance, delta);
    const negative = isNegative(nextBalance);
    return {
      currentBalance,
      delta,
      nextBalance,
      deficit: negative ? absolute(nextBalance) : "0",
    };
  } catch {
    return undefined;
  }
}

/**
 * 这个函数回答：人选中的那条规则，建议手续费是哪个？
 * 没选、或选的规则已不在匹配结果里，返回空。
 * 举例：两条规则冲突，人选了其中一条 → 答那一条的建议手续费。
 * 不会出错。
 */
export function getSelectedCandidate(
  match: ReturnType<typeof matchFeeRules>,
  selectedFeeRuleId: string,
): FeeRuleCandidate | undefined {
  if (selectedFeeRuleId === "") return undefined;
  if (match.status === "matched") {
    return match.candidate.rule.id === selectedFeeRuleId
      ? match.candidate
      : undefined;
  }
  if (match.status === "conflict") {
    return match.candidates.find(
      ({ rule }) => rule.id === selectedFeeRuleId,
    );
  }
  return undefined;
}
