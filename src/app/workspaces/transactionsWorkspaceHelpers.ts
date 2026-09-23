import { type LedgerActivityTypeFilter } from "@/features/activity";
import type { useLanguage } from "@/ui";

export const DELETE_DELAY_MS = 5_000;
export const SUCCESS_FEEDBACK_MS = 4_000;

export function activityFilterLabel(
  type: LedgerActivityTypeFilter,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  return {
    all: t("transactions.time.all"),
    buy: t("trades.type.buy"),
    sell: t("trades.type.sell"),
    deposit: t("transactions.type.deposit"),
    withdrawal: t("transactions.type.withdrawal"),
    "external-expense": t("transactions.type.externalExpense"),
    "balance-adjustment": t("transactions.type.balanceAdjustment"),
  }[type];
}
