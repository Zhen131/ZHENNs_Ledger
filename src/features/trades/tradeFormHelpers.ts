import type { TradeDraft } from "@/core/models";
import { calculateTradeUsdtCashDelta } from "@/core/calculations";
import { matchFeeRules, type FeeRuleCandidate } from "@/features/fees";
import type {
  TradeValidationError,
  TradeValidationField,
} from "@/core/validation";
import { absolute, add, isNegative, multiply } from "@/core/shared";
import type { TranslationKey, useLanguage } from "@/ui";
import type { TradeFormState, TradeFormField } from "./tradeFormTypes";

export const SUCCESS_FEEDBACK_MS = 4_000;

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

export function formatValidationError(
  error: TradeValidationError,
  t: ReturnType<typeof useLanguage>["t"],
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

export function calculateAutomaticTotal(quantity: string, price: string): string {
  if (quantity === "" || price === "") return "";
  try {
    return multiply(quantity, price);
  } catch {
    return "";
  }
}

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
