"use client";

import { type ReactNode } from "react";
import type { CashEvent } from "@/core/models";
import { subtract } from "@/core/shared";
import { LedgerNumber, useLanguage } from "@/ui";
import type { LedgerActivityItem } from "./activityService";

export function activityTypeLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return item.kind === "trade"
    ? item.trade.type === "buy"
      ? t("trades.type.buy")
      : t("trades.type.sell")
    : cashEventTypeLabel(item.cashEvent, t);
}

export function cashEventTypeLabel(event: CashEvent, t: ReturnType<typeof useLanguage>["t"]): string {
  return {
    deposit: t("cash.type.deposit"), withdrawal: t("cash.type.withdrawal"), "external-expense": t("cash.type.externalExpense"), "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[event.type];
}

export function activityAssetLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return item.kind === "trade" ? item.trade.assetSymbol : t("activity.table.cashUsdt");
}

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

export function activityDeleteLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("activity.table.deletePrefix")} ${activityTypeLabel(item, t)} ${activityAssetLabel(item, t)} ${item.occurredAt}`;
}

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

export function getActivityOccurredTimeZone(item: LedgerActivityItem): string | undefined {
  return item.kind === "trade"
    ? item.trade.occurredTimeZone
    : item.cashEvent.occurredTimeZone;
}
