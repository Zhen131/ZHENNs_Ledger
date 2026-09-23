import type { LedgerData } from "@/core/models";
import { isNegative, toDecimal } from "@/core/shared";
import type { useLanguage } from "@/ui";

export type FormState = {
  name: string;
  platform: string;
  assetSymbol: string;
  type: "fixed" | "percentage";
  value: string;
};

export const initialForm: FormState = {
  name: "",
  platform: "",
  assetSymbol: "BTC",
  type: "fixed",
  value: "",
};

export const SUCCESS_FEEDBACK_MS = 4_000;
type Translate = ReturnType<typeof useLanguage>["t"];

export function createUniqueFeeRuleId(ledgerData: LedgerData): string | undefined {
  const existingIds = new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let candidate: string;
    try {
      candidate = globalThis.crypto.randomUUID();
    } catch {
      return undefined;
    }
    if (
      candidate.length > 0 &&
      candidate.length <= 128 &&
      candidate.trim() === candidate &&
      !existingIds.has(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function validateForm(form: FormState, t: Translate): string | null {
  if (!form.name || form.name !== form.name.trim()) {
    return t("fees.error.nameInvalid");
  }
  if (!form.platform || form.platform !== form.platform.trim()) {
    return t("fees.error.platformInvalid");
  }
  if (!form.assetSymbol) return t("fees.error.assetRequired");
  if (!isValidNonNegativeDecimal(form.value)) {
    return t("fees.error.valueInvalid");
  }
  return null;
}

export function isValidNonNegativeDecimal(value: string): boolean {
  try {
    toDecimal(value);
    return !isNegative(value);
  } catch {
    return false;
  }
}
