/**
 * 这个文件放现金面板共用的两个类型和一个取名函数。
 * 真正的点按处理在 `cashEventPanelActions.ts`，画面在 `CashEventPanel.tsx`。
 * 没有特别的决定。
 */
import type { CashEvent, CashEventType } from "@/core/models";
import { type LedgerTimeSnapshot } from "@/core/shared";
import { type CashMutationProjection } from "./cashProjection";
import type { Translate } from "@/ui";

/**
 * 等人确认的那一步：要加或要删哪条现金记录、改完的余额。
 * 还记着当时是哪本账本、第几版，版本一变确认就作废。
 */
export type PendingRisk = Readonly<{
  operation: "add" | "delete";
  cashEvent: CashEvent;
  projection: CashMutationProjection;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  timeSnapshot: LedgerTimeSnapshot;
}>;

/**
 * 点过一次「删除」、等第二次点的那条现金记录。
 * 也记着当时是哪本账本、第几版。
 */
export type ArmedDelete = Readonly<{
  cashEventId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;


/**
 * 这个函数回答：这种现金记录在界面上叫什么？
 * 举例：`deposit` → 答「入金」（按当前语言）。
 * 不会出错。
 */
export function cashTypeLabel(type: CashEventType, t: Translate): string {
  return {
    deposit: t("cash.type.deposit"),
    withdrawal: t("cash.type.withdrawal"),
    "external-expense": t("cash.type.externalExpense"),
    "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[type];
}
