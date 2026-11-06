/**
 * 这个文件放价格表单用的两个类型和两个小函数。
 * 按钮按下后做什么在 `priceFormActions.ts`。
 * 没有特别的决定。
 */
import { type PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { PriceSnapshotDraft } from "@/core/models";
import type {
  PriceSnapshotValidationError,
  PriceSnapshotValidationField,
} from "@/core/validation";
import type { Translate } from "@/ui";


/** 价格表单的值，和记账页的价格草稿是同一个形状。 */
export type PriceFormState = PriceWorkspaceDraft;

/** 错误提示能挂在哪一栏：表单的某一栏，或整个表单。 */
export type PriceFormField = keyof PriceFormState | "form";


/**
 * 这个函数回答：一条检查错误该显示在价格表单哪一栏旁边？
 * 表单上没有那一栏的，都显示在整个表单的顶上。
 * 举例：`currency` 出错 → 答 `form`。
 * 不会出错。
 */
export function toPriceFormField(
  field: PriceSnapshotValidationField,
): PriceFormField {
  switch (field) {
    case "assetSymbol":
    case "price":
    case "recordedAt":
    case "note":
      return field;
    case "input":
    case "currency":
    case "occurredTimeZone":
    case "source":
    case "binanceProvenance":
      return "form";
  }
}

/**
 * 这个函数回答：一条价格检查错误在界面上怎么说？
 * 按错误代码挑一句话，必要时在前面加上那一栏的名字。
 * 举例：价格填 0 → 答「价格必须大于 0」（按当前语言）。
 * 不会出错。
 */
export function formatValidationError(
  error: PriceSnapshotValidationError,
  t: Translate,
): string {
  const fieldLabels: Record<keyof PriceSnapshotDraft, string> = {
    assetSymbol: t("prices.field.assetSymbolLabel"),
    price: t("prices.field.currentPrice"),
    currency: t("prices.field.currency"),
    recordedAt: t("prices.field.date"),
    occurredTimeZone: t("prices.field.timeZone"),
    source: t("prices.field.source"),
    binanceProvenance: t("prices.field.binanceProvenance"),
    note: t("prices.field.note"),
  };
  const label = error.field === "input" ? t("prices.field.price") : fieldLabels[error.field];

  switch (error.code) {
    case "PRICE_SNAPSHOT_ASSET_NOT_FOUND":
      return t("prices.validation.assetNotFound");
    case "PRICE_SNAPSHOT_INVALID_DECIMAL":
      return t("prices.validation.invalidDecimal");
    case "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE":
      return t("prices.validation.positive");
    case "PRICE_SNAPSHOT_CURRENCY_MISMATCH":
      return t("prices.validation.currencyMismatch");
    case "PRICE_SNAPSHOT_INVALID_SOURCE":
      return t("prices.validation.invalidSource");
    case "PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE":
    case "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED":
      return t("prices.validation.invalidBinanceProvenance");
    case "PRICE_SNAPSHOT_FUTURE_FACT":
      return t("prices.validation.futureFact");
    case "PRICE_SNAPSHOT_UNSUPPORTED_VALUATION_CURRENCY":
      return t("prices.validation.unsupportedCurrency");
    case "PRICE_SNAPSHOT_NEW_FACT_REQUIRES_USDT":
      return t("prices.validation.newFactRequiresUsdt");
    case "PRICE_SNAPSHOT_INVALID_INPUT":
      return `${label}${t("prices.validation.invalidInputSuffix")}`;
  }
}
