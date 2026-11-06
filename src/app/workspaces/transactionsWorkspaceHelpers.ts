import { type LedgerActivityTypeFilter } from "@/features/activity";
import type { Translate } from "@/ui";

export const DELETE_DELAY_MS = 5_000;

export function activityFilterLabel(
  type: LedgerActivityTypeFilter,
  t: Translate,
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
