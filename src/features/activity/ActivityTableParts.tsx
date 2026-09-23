"use client";

import { type ReactNode } from "react";
import { calculateTradeCashImpact } from "@/core/calculations";
import { LedgerNumber, useLanguage } from "@/ui";
import type { LedgerActivityItem } from "./activityService";
import { cashEventTypeLabel } from "./activityTableLabels";

export function ActivityCell({
  label,
  children,
  className = "",
}: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return (
    <td className={`grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2 break-words py-1 text-[var(--ledger-muted)] sm:table-cell sm:px-3 sm:py-3 ${className}`}>
      <span className="font-medium text-[var(--ledger-muted)] sm:hidden">
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </td>
  );
}

export function ActivityDetails({ item }: Readonly<{ item: LedgerActivityItem }>) {
  const { t } = useLanguage();
  if (item.kind === "trade") {
    const cashImpact = calculateTradeCashImpact(item.trade);
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("activity.details.factId")} value={item.trade.id} />
        <Detail
          label={t("activity.details.quantity")}
          value={<LedgerNumber kind="quantity" value={item.trade.quantity} />}
        />
        <Detail
          label={t("activity.details.averagePrice")}
          value={
            <>
              <LedgerNumber kind="money" value={item.trade.price} />{" "}
              {item.trade.currency}
            </>
          }
        />
        <Detail
          label={t("activity.details.totalValue")}
          value={
            <>
              <LedgerNumber kind="money" value={item.trade.totalValue} />{" "}
              {item.trade.currency}
            </>
          }
        />
        <Detail
          label={t("activity.details.actualFee")}
          value={
            <>
              <LedgerNumber
                kind={item.trade.feeCurrency === "USDT" ? "money" : "quantity"}
                value={item.trade.fee}
              />{" "}
              {item.trade.feeCurrency}
            </>
          }
        />
        <Detail label={t("activity.details.platform")} value={item.trade.platform ?? t("activity.details.notFilled")} />
        <Detail
          label={t("activity.details.feeSource")}
          value={
            item.trade.feeRuleId ? `FeeRule ${item.trade.feeRuleId}` : t("activity.details.manual")
          }
        />
        <Detail
          label={t("activity.details.cashImpact")}
          value={cashImpact.ok ? (
            <>
              <LedgerNumber kind="money" value={cashImpact.amount} />{" "}
              {cashImpact.currency} · {cashImpact.kind === "buy-outflow"
                ? t("activity.details.buyOutflow")
                : t("activity.details.sellProceeds")}
            </>
          ) : `${t("activity.details.unreliablePrefix")}${t("activity.details.unreliableSeparator")}${cashImpact.feeCurrency} ${t("activity.details.unconvertedFee")}`}
        />
        <Detail label={t("activity.details.note")} value={item.trade.note ?? t("activity.details.notFilled")} />
        <Detail label={t("activity.details.occurredAt")} value={item.trade.occurredAt} />
        {item.trade.occurredTimeZone ? (
          <Detail
            label={t("activity.details.occurredTimeZone")}
            value={item.trade.occurredTimeZone}
          />
        ) : null}
        <Detail label={t("activity.details.timePrecision")} value={item.trade.timePrecision} />
        <Detail label={t("activity.details.createdAt")} value={item.trade.createdAt} />
        <Detail label={t("activity.details.updatedAt")} value={item.trade.updatedAt} />
      </div>
    );
  }

  const event = item.cashEvent;
  const details: Array<{ label: string; value: ReactNode }> = [
    { label: t("activity.details.factId"), value: event.id },
    { label: t("activity.details.type"), value: cashEventTypeLabel(event, t) },
    { label: t("activity.details.currency"), value: event.currency },
    { label: t("activity.details.occurredAt"), value: event.occurredAt },
    ...(event.occurredTimeZone
      ? [{ label: t("activity.details.occurredTimeZone"), value: event.occurredTimeZone }]
      : []),
    { label: t("activity.details.timePrecision"), value: event.timePrecision },
    ...(event.type === "balance-adjustment"
      ? [
          {
            label: t("activity.details.balanceBefore"),
            value: <><LedgerNumber kind="money" value={event.balanceBefore} /> USDT</>,
          },
          {
            label: t("activity.details.targetBalance"),
            value: <><LedgerNumber kind="money" value={event.targetBalance} /> USDT</>,
          },
          {
            label: t("activity.details.adjustmentAmount"),
            value: <><LedgerNumber kind="money" value={event.adjustmentAmount} /> USDT</>,
          },
        ]
      : [{
          label: t("activity.table.amount"),
          value: <><LedgerNumber kind="money" value={event.amount} /> USDT</>,
        }]),
    { label: t("activity.details.note"), value: event.note ?? t("activity.details.notFilled") },
    { label: t("activity.details.createdAt"), value: event.createdAt },
    { label: t("activity.details.updatedAt"), value: event.updatedAt },
  ];
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {details.map((detail) => (
        <Detail key={detail.label} {...detail} />
      ))}
    </div>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-[var(--ledger-muted)]">{label}</p>
      <p className="mt-1 break-words text-[var(--ledger-ink)]">{value}</p>
    </div>
  );
}
