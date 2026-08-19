"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { calculateTradeCashImpact } from "@/core/calculations";
import type { CashEvent } from "@/core/models";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
} from "@/core/shared";
import {
  TradeDeleteControl,
  type TradeDeletePhase,
} from "@/features/trades/ui";
import type { LedgerActivityItem } from "./activityService";

export type ActivityDeleteState = Readonly<{
  armedItemId: string | null;
  pendingItemId: string | null;
  pendingPhase: "countdown" | "persisting" | null;
  remainingMs: number;
}>;

export function ActivityTable({
  items,
  todayKey,
  deleteDisabled = false,
  expandedItemId,
  onExpandedItemIdChange,
  deleteState,
  onArmDelete,
  onConfirmDelete,
  onCancelDelete,
  onUndoDelete,
  locateRequest,
  onLocateComplete,
}: Readonly<{
  items: readonly LedgerActivityItem[];
  todayKey: string;
  deleteDisabled?: boolean;
  expandedItemId: string | null;
  onExpandedItemIdChange: (itemId: string | null) => void;
  deleteState: ActivityDeleteState;
  onArmDelete: (item: LedgerActivityItem) => void;
  onConfirmDelete: (item: LedgerActivityItem) => void;
  onCancelDelete: () => void;
  onUndoDelete: () => void;
  locateRequest: Readonly<{ date: string; requestId: number }> | null;
  onLocateComplete: (
    requestId: number,
    result: "found" | "missing",
  ) => void;
}>) {
  const detailButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [locatedDate, setLocatedDate] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<
    "flashing" | "static" | null
  >(null);

  useEffect(() => {
    if (expandedItemId) {
      rowRefs.current.get(expandedItemId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [expandedItemId]);

  useEffect(() => {
    if (!expandedItemId) return;
    const collapseFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const itemId = expandedItemId;
      onExpandedItemIdChange(null);
      requestAnimationFrame(() => detailButtonRefs.current.get(itemId)?.focus());
    };
    document.addEventListener("keydown", collapseFromEscape);
    return () => document.removeEventListener("keydown", collapseFromEscape);
  }, [expandedItemId, onExpandedItemIdChange]);

  useEffect(() => {
    setLocatedDate(null);
    setLocationMode(null);
    if (!locateRequest) return;
    const target = items.find(
      (item) => getLedgerDateKey(item.occurredAt) === locateRequest.date,
    );
    const targetRow = target ? rowRefs.current.get(target.id) : undefined;
    if (!targetRow) {
      onLocateComplete(locateRequest.requestId, "missing");
      return;
    }

    let cancelled = false;
    let highlightStarted = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollContainer =
      targetRow.closest<HTMLElement>("[data-ledger-scroll-container]") ??
      document;
    const supportsScrollEnd = "onscrollend" in scrollContainer;
    const finish = () => {
      if (cancelled) return;
      setLocatedDate(null);
      setLocationMode(null);
      onLocateComplete(locateRequest.requestId, "found");
    };
    const begin = () => {
      if (cancelled || highlightStarted) return;
      highlightStarted = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      scrollContainer.removeEventListener("scrollend", begin);
      setLocatedDate(locateRequest.date);
      setLocationMode("flashing");
      highlightTimer = setTimeout(finish, 800);
    };
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      targetRow.scrollIntoView?.({ behavior: "auto", block: "center" });
      setLocatedDate(locateRequest.date);
      setLocationMode("static");
      highlightTimer = setTimeout(finish, 1_200);
    } else {
      targetRow.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (supportsScrollEnd) {
        scrollContainer.addEventListener("scrollend", begin, { once: true });
      }
      fallbackTimer = setTimeout(begin, supportsScrollEnd ? 500 : 250);
    }
    return () => {
      cancelled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (highlightTimer !== null) clearTimeout(highlightTimer);
      scrollContainer.removeEventListener("scrollend", begin);
    };
  }, [items, locateRequest, onLocateComplete]);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--ledger-border)]">
      <table className="block w-full text-left text-sm sm:table">
        <thead className="hidden bg-[var(--ledger-surface-muted)] text-[var(--ledger-muted)] sm:table-header-group">
          <tr>
            <th className="px-4 py-3 font-medium">日期</th>
            <th className="px-3 py-3 font-medium">类型</th>
            <th className="px-3 py-3 font-medium">资产</th>
            <th className="px-3 py-3 font-medium">金额</th>
            <th className="px-3 py-3 font-medium">手续费</th>
            <th className="w-56 px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-[var(--ledger-border)] bg-white sm:table-row-group">
          {items.length === 0 ? (
            <tr className="block sm:table-row">
              <td
                className="block px-4 py-12 text-center text-[var(--ledger-muted)] sm:table-cell"
                colSpan={6}
              >
                没有符合当前筛选的流水。
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const expanded = expandedItemId === item.id;
              const isPending = deleteState.pendingItemId === item.id;
              const phase: TradeDeletePhase =
                deleteState.armedItemId === item.id
                  ? "armed"
                  : isPending && deleteState.pendingPhase
                    ? deleteState.pendingPhase
                    : "idle";
              const dateKey = getLedgerDateKey(item.occurredAt);
              const isLocated = locatedDate === dateKey;
              const rowDeleteDisabled =
                deleteDisabled ||
                (deleteState.pendingPhase === "persisting" && !isPending);
              return (
                <Fragment key={`${item.kind}:${item.id}`}>
                  <tr
                    aria-expanded={expanded}
                    className={`grid min-w-0 gap-2 p-3 sm:table-row sm:p-0 ${
                      isPending ? "bg-slate-50 opacity-70" : "hover:bg-[#fbfaf7]"
                    } ${
                      isLocated
                        ? locationMode === "static"
                          ? "ledger-trade-locate-static"
                          : "ledger-trade-locate-flash"
                        : ""
                    } cursor-pointer`}
                    data-activity-date={dateKey}
                    data-activity-id={item.id}
                    data-locate-highlight={isLocated ? locationMode : undefined}
                    data-trade-date={item.kind === "trade" ? dateKey : undefined}
                    data-trade-id={item.kind === "trade" ? item.id : undefined}
                    onClick={(event) => {
                      if (
                        isPending ||
                        (event.target as HTMLElement).closest(
                          "button, a, input, select",
                        )
                      ) {
                        return;
                      }
                      onExpandedItemIdChange(expanded ? null : item.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        isPending ||
                        (event.key !== "Enter" && event.key !== " ")
                      ) {
                        return;
                      }
                      event.preventDefault();
                      onExpandedItemIdChange(expanded ? null : item.id);
                    }}
                    ref={(node) => {
                      if (node) rowRefs.current.set(item.id, node);
                      else rowRefs.current.delete(item.id);
                    }}
                    tabIndex={isPending ? -1 : 0}
                  >
                    <ActivityCell label="日期">
                      {item.occurredAt}
                      {isLedgerFactInFuture(item.occurredAt, todayKey) ? (
                        <span className="ml-2 font-medium text-red-700">
                          未来事实
                        </span>
                      ) : null}
                    </ActivityCell>
                    <ActivityCell label="类型">
                      <span className={activityBadgeClass(item)}>
                        {activityTypeLabel(item)}
                      </span>
                    </ActivityCell>
                    <ActivityCell label="资产">
                      <strong>{activityAssetLabel(item)}</strong>
                    </ActivityCell>
                    <ActivityCell label="金额">
                      {activityAmountLabel(item)}
                    </ActivityCell>
                    <ActivityCell label="手续费">
                      {item.kind === "trade"
                        ? `${item.trade.fee} ${item.trade.feeCurrency}`
                        : "—"}
                    </ActivityCell>
                    <td className="block min-w-0 py-1 sm:table-cell sm:px-4 sm:py-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        {phase === "idle" ? (
                          <button
                            aria-expanded={expanded}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700"
                            onClick={() =>
                              onExpandedItemIdChange(expanded ? null : item.id)
                            }
                            ref={(node) => {
                              if (node) detailButtonRefs.current.set(item.id, node);
                              else detailButtonRefs.current.delete(item.id);
                            }}
                            type="button"
                          >
                            详情
                          </button>
                        ) : null}
                        <TradeDeleteControl
                          ariaLabel={activityDeleteLabel(item)}
                          className={phase === "idle" ? "" : "col-span-2"}
                          disabled={rowDeleteDisabled}
                          onActivate={() =>
                            phase === "armed"
                              ? onConfirmDelete(item)
                              : onArmDelete(item)
                          }
                          onCancel={onCancelDelete}
                          onUndo={onUndoDelete}
                          phase={phase}
                          remainingMs={isPending ? deleteState.remainingMs : 0}
                        />
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="block bg-[#fbfaf7] sm:table-row">
                      <td className="block px-4 py-4 sm:table-cell" colSpan={6}>
                        <ActivityDetails item={item} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActivityCell({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <td className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2 break-words py-1 text-[var(--ledger-muted)] sm:table-cell sm:px-3 sm:py-3">
      <span className="font-medium text-[var(--ledger-muted)] sm:hidden">
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </td>
  );
}

function ActivityDetails({ item }: Readonly<{ item: LedgerActivityItem }>) {
  if (item.kind === "trade") {
    const cashImpact = calculateTradeCashImpact(item.trade);
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="事实 ID" value={item.trade.id} />
        <Detail label="数量" value={item.trade.quantity} />
        <Detail
          label="成交均价"
          value={`${item.trade.price} ${item.trade.currency}`}
        />
        <Detail
          label="成交金额"
          value={`${item.trade.totalValue} ${item.trade.currency}`}
        />
        <Detail
          label="实际手续费"
          value={`${item.trade.fee} ${item.trade.feeCurrency}`}
        />
        <Detail label="平台" value={item.trade.platform ?? "未填写"} />
        <Detail
          label="手续费来源"
          value={
            item.trade.feeRuleId ? `FeeRule ${item.trade.feeRuleId}` : "手填"
          }
        />
        <Detail
          label="现金影响与可靠性"
          value={
            cashImpact.ok
              ? `${cashImpact.amount} ${cashImpact.currency} · ${
                  cashImpact.kind === "buy-outflow" ? "买入总支出" : "卖出净到账"
                }`
              : `不可可靠计算：${cashImpact.feeCurrency} 手续费未换算`
          }
        />
        <Detail label="备注" value={item.trade.note ?? "未填写"} />
        <Detail label="时间精度" value={item.trade.timePrecision} />
        <Detail label="创建时间" value={item.trade.createdAt} />
        <Detail label="更新时间" value={item.trade.updatedAt} />
      </div>
    );
  }

  const event = item.cashEvent;
  const details: Array<{ label: string; value: string }> = [
    { label: "事实 ID", value: event.id },
    { label: "类型", value: cashEventTypeLabel(event) },
    { label: "币种", value: event.currency },
    { label: "发生时间", value: event.occurredAt },
    { label: "时间精度", value: event.timePrecision },
    ...(event.type === "balance-adjustment"
      ? [
          { label: "校准前余额", value: `${event.balanceBefore} USDT` },
          { label: "目标余额", value: `${event.targetBalance} USDT` },
          { label: "本次差额", value: `${event.adjustmentAmount} USDT` },
        ]
      : [{ label: "金额", value: `${event.amount} USDT` }]),
    { label: "备注", value: event.note ?? "未填写" },
    { label: "创建时间", value: event.createdAt },
    { label: "更新时间", value: event.updatedAt },
  ];
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {details.map((detail) => (
        <Detail key={detail.label} {...detail} />
      ))}
    </div>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-[var(--ledger-muted)]">{label}</p>
      <p className="mt-1 break-words text-[var(--ledger-ink)]">{value}</p>
    </div>
  );
}

function activityTypeLabel(item: LedgerActivityItem): string {
  return item.kind === "trade"
    ? item.trade.type === "buy"
      ? "买入"
      : "卖出"
    : cashEventTypeLabel(item.cashEvent);
}

function cashEventTypeLabel(event: CashEvent): string {
  return {
    deposit: "入金",
    withdrawal: "出金",
    "external-expense": "外部支出",
    "balance-adjustment": "余额校准",
  }[event.type];
}

function activityAssetLabel(item: LedgerActivityItem): string {
  return item.kind === "trade" ? item.trade.assetSymbol : "现金 USDT";
}

function activityAmountLabel(item: LedgerActivityItem): string {
  if (item.kind === "trade") {
    return `${item.trade.totalValue} ${item.trade.currency}`;
  }
  const event = item.cashEvent;
  const delta =
    event.type === "balance-adjustment"
      ? event.adjustmentAmount
      : event.type === "deposit"
        ? event.amount
        : `-${event.amount}`;
  return `${delta} USDT`;
}

function activityDeleteLabel(item: LedgerActivityItem): string {
  return `删除 ${activityTypeLabel(item)} ${activityAssetLabel(item)} ${item.occurredAt}`;
}

function activityBadgeClass(item: LedgerActivityItem): string {
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
