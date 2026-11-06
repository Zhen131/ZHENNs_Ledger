/**
 * 这个文件放交易表每一行要用的几段文字和样式。
 * 表格本身在 `ActivityTable.tsx` 和 `ActivityTableRow.tsx`。
 * 没有特别的决定。
 */
"use client";

import { type ReactNode } from "react";
import type { CashEvent } from "@/core/models";
import { subtract } from "@/core/shared";
import { LedgerNumber, type Translate } from "@/ui";
import type { LedgerActivityItem } from "./activityService";

/** 这个函数回答：这一行的类型叫什么？买入、卖出，或某种现金记录。 */
export function activityTypeLabel(item: LedgerActivityItem, t: Translate): string {
  return item.kind === "trade"
    ? item.trade.type === "buy"
      ? t("trades.type.buy")
      : t("trades.type.sell")
    : cashEventTypeLabel(item.cashEvent, t);
}

/** 这个函数回答：这种现金记录叫什么？按当前语言。 */
export function cashEventTypeLabel(event: CashEvent, t: Translate): string {
  return {
    deposit: t("cash.type.deposit"), withdrawal: t("cash.type.withdrawal"), "external-expense": t("cash.type.externalExpense"), "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[event.type];
}

/** 这个函数回答：这一行是哪种币？现金记录写「现金 USDT」。 */
export function activityAssetLabel(item: LedgerActivityItem, t: Translate): string {
  return item.kind === "trade" ? item.trade.assetSymbol : t("activity.table.cashUsdt");
}

/**
 * 这个函数回答：这一行的金额栏写什么？
 * 买卖写成交金额和币种。
 * 现金记录写现金变化：入金为正，出金和外部支出为负。
 * 校准写差额。
 * 举例：出金 300 → 答「-300 USDT」。
 * 举例：校准从 100 到 80 → 答「-20 USDT」。
 * 不会出错。
 */
export function activityAmountLabel(item: LedgerActivityItem): ReactNode {
  if (item.kind === "trade") {
    return (
      <>
        <LedgerNumber kind="money" value={item.trade.totalValue} />{" "}
        {item.trade.currency}
      </>
    );
  }
  const event = item.cashEvent;
  const delta =
    event.type === "balance-adjustment"
      ? event.adjustmentAmount
      : event.type === "deposit"
        ? event.amount
        : subtract("0", event.amount);
  return <><LedgerNumber kind="money" value={delta} /> USDT</>;
}

/**
 * 这个函数回答：这一行的删除按钮，读屏软件该念什么？
 * 念出「删除」、类型、币和发生时刻。
 */
export function activityDeleteLabel(item: LedgerActivityItem, t: Translate): string {
  return `${t("activity.table.deletePrefix")} ${activityTypeLabel(item, t)} ${activityAssetLabel(item, t)} ${item.occurredAt}`;
}

/**
 * 这个函数回答：这一行的类型小标签用什么颜色？
 * 买入和入金绿，卖出和出金橙，外部支出红，校准蓝。
 */
export function activityBadgeClass(item: LedgerActivityItem): string {
  const type = item.kind === "trade" ? item.trade.type : item.cashEvent.type;
  const tone =
    type === "buy" || type === "deposit"
      ? "bg-emerald-50 text-emerald-800"
      : type === "sell" || type === "withdrawal"
        ? "bg-amber-50 text-amber-900"
        : type === "external-expense"
          ? "bg-red-50 text-red-800"
          : "bg-sky-50 text-sky-800";
  return `inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone}`;
}

/** 这个函数取出这一行记下来的地点，没有就返回空。 */
export function getActivityOccurredTimeZone(item: LedgerActivityItem): string | undefined {
  return item.kind === "trade"
    ? item.trade.occurredTimeZone
    : item.cashEvent.occurredTimeZone;
}
