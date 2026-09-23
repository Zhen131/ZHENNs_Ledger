import type { LedgerData } from "@/core/models";

export function getDefaultValuationCurrency(
  ledgerData: LedgerData,
): "USD" | "USDT" {
  return ledgerData.assets.some((asset) => asset.quoteCurrency === "USDT")
    ? "USDT"
    : "USD";
}
