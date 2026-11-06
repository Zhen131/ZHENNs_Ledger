/**
 * 这个文件放交易页的一个小帮手：筛选类型在下拉里叫什么。
 * 筛选怎么用在 `TransactionsWorkspace.tsx` 里。
 * 没有特别的决定。
 */
import { type LedgerActivityTypeFilter } from "@/features/activity";
import type { Translate } from "@/ui";

/**
 * 这个函数回答：一种流水筛选类型，在当前语言里叫什么？
 * 举例：中文界面的 `buy` → 答「买入」。
 * 不会出错。
 */
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
