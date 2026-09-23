import { type PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { PriceSnapshotDraft } from "@/core/models";
import type {
  PriceSnapshotValidationError,
  PriceSnapshotValidationField,
} from "@/core/validation";
import type { useLanguage } from "@/ui";

export const SUCCESS_FEEDBACK_MS = 4_000;

export type PriceFormState = PriceWorkspaceDraft;

export type PriceFormField = keyof PriceFormState | "form";

type Translate = ReturnType<typeof useLanguage>["t"];

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
