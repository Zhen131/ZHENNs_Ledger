"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { calculateTradeCashImpact } from "@/core/calculations";
import type { Trade } from "@/core/models";
import { getLedgerDateKey, isLedgerFactInFuture } from "@/core/shared";
import {
  ConfirmDeleteButton,
  type ConfirmDeleteOutcome,
} from "@/ui";
import {
  TradeDeleteControl,
  type TradeDeletePhase,
} from "./TradeDeleteControl";

type WorkspaceDeleteState = Readonly<{
  armedTradeId: string | null;
  pendingTradeId: string | null;
  pendingPhase: "countdown" | "persisting" | null;
  remainingMs: number;
}>;

type TradeTableProps = Readonly<{
  trades: readonly Trade[];
  onDelete?: (
    tradeId: string,
  ) => ConfirmDeleteOutcome | Promise<ConfirmDeleteOutcome>;
  deleteDisabled?: boolean;
  todayKey?: string;
  variant?: "legacy" | "workspace";
  expandedTradeId?: string | null;
  onExpandedTradeIdChange?: (tradeId: string | null) => void;
  deleteState?: WorkspaceDeleteState;
  onArmDelete?: (tradeId: string) => void;
  onConfirmDelete?: (tradeId: string) => void;
  onCancelDelete?: () => void;
  onUndoDelete?: () => void;
  locateRequest?: Readonly<{ date: string; requestId: number }> | null;
  onLocateComplete?: (
    requestId: number,
    result: "found" | "missing",
  ) => void;
}>;

const ignoreLocationResult = () => undefined;

export function TradeTable({
  variant = "legacy",
  ...props
}: TradeTableProps) {
  return variant === "workspace" ? (
    <WorkspaceTradeTable {...props} />
  ) : (
    <LegacyTradeTable {...props} />
  );
}

function WorkspaceTradeTable({
  trades,
  todayKey,
  deleteDisabled = false,
  expandedTradeId = null,
  onExpandedTradeIdChange = () => undefined,
  deleteState = {
    armedTradeId: null,
    pendingTradeId: null,
    pendingPhase: null,
    remainingMs: 0,
  },
  onArmDelete = () => undefined,
  onConfirmDelete = () => undefined,
  onCancelDelete = () => undefined,
  onUndoDelete = () => undefined,
  locateRequest = null,
  onLocateComplete = ignoreLocationResult,
}: Omit<TradeTableProps, "variant" | "onDelete">) {
  const detailButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [locatedDate, setLocatedDate] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<
    "flashing" | "static" | null
  >(null);

  useEffect(() => {
    if (expandedTradeId) {
      rowRefs.current.get(expandedTradeId)?.scrollIntoView?.({
        block: "nearest",
      });
    }
  }, [expandedTradeId]);

  useEffect(() => {
    if (!expandedTradeId) return;
    const collapseFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const tradeId = expandedTradeId;
      onExpandedTradeIdChange(null);
      requestAnimationFrame(() => detailButtonRefs.current.get(tradeId)?.focus());
    };
    document.addEventListener("keydown", collapseFromEscape);
    return () => document.removeEventListener("keydown", collapseFromEscape);
  }, [expandedTradeId, onExpandedTradeIdChange]);

  useEffect(() => {
    setLocatedDate(null);
    setLocationMode(null);
    if (!locateRequest) return;

    const targetTrade = trades.find(
      (trade) => getLedgerDateKey(trade.occurredAt) === locateRequest.date,
    );
    if (!targetTrade) {
      onLocateComplete(locateRequest.requestId, "missing");
      return;
    }
    const targetRow = rowRefs.current.get(targetTrade.id);
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

    const finishLocation = () => {
      if (cancelled) return;
      setLocatedDate(null);
      setLocationMode(null);
      onLocateComplete(locateRequest.requestId, "found");
    };
    const beginFlashing = () => {
      if (cancelled || highlightStarted) return;
      highlightStarted = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      scrollContainer.removeEventListener("scrollend", beginFlashing);
      setLocatedDate(locateRequest.date);
      setLocationMode("flashing");
      highlightTimer = setTimeout(finishLocation, 800);
    };

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      targetRow.scrollIntoView?.({ behavior: "auto", block: "center" });
      setLocatedDate(locateRequest.date);
      setLocationMode("static");
      highlightTimer = setTimeout(finishLocation, 1_200);
    } else {
      targetRow.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (supportsScrollEnd) {
        scrollContainer.addEventListener("scrollend", beginFlashing, {
          once: true,
        });
      }
      fallbackTimer = setTimeout(beginFlashing, supportsScrollEnd ? 500 : 250);
    }

    return () => {
      cancelled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (highlightTimer !== null) clearTimeout(highlightTimer);
      scrollContainer.removeEventListener("scrollend", beginFlashing);
    };
  }, [locateRequest, onLocateComplete, trades]);

  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-[var(--ledger-border)]">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--ledger-surface-muted)] text-[var(--ledger-muted)]">
          <tr>
            <th className="px-4 py-3 font-medium">日期</th>
            <th className="px-3 py-3 font-medium">类型</th>
            <th className="px-3 py-3 font-medium">资产</th>
            <th className="px-3 py-3 font-medium">成交金额</th>
            <th className="px-3 py-3 font-medium">手续费</th>
            <th className="w-56 px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ledger-border)] bg-white">
          {trades.length === 0 ? (
            <tr>
              <td className="px-4 py-12 text-center text-[var(--ledger-muted)]" colSpan={6}>
                没有符合当前筛选的交易。
              </td>
            </tr>
          ) : (
            trades.map((trade) => {
              const expanded = expandedTradeId === trade.id;
              const isPending = deleteState.pendingTradeId === trade.id;
              const phase: TradeDeletePhase =
                deleteState.armedTradeId === trade.id
                  ? "armed"
                  : isPending && deleteState.pendingPhase
                    ? deleteState.pendingPhase
                    : "idle";
              const cashImpact = calculateTradeCashImpact(trade);
              const rowDeleteDisabled =
                deleteDisabled ||
                (deleteState.pendingPhase === "persisting" && !isPending);
              const isLocated =
                locatedDate !== null &&
                getLedgerDateKey(trade.occurredAt) === locatedDate;
              const locationClass = isLocated
                ? locationMode === "static"
                  ? "ledger-trade-locate-static"
                  : "ledger-trade-locate-flash"
                : "";

              return (
                <Fragment key={trade.id}>
                  <tr
                    aria-expanded={expanded}
                    className={`${
                      isPending ? "bg-slate-50 opacity-70" : "hover:bg-[#fbfaf7]"
                    } ${locationClass} cursor-pointer`}
                    data-locate-highlight={
                      isLocated ? locationMode : undefined
                    }
                    data-trade-date={getLedgerDateKey(trade.occurredAt)}
                    data-trade-id={trade.id}
                    onClick={(event) => {
                      if (
                        isPending ||
                        (event.target as HTMLElement).closest(
                          "button, a, input, select",
                        )
                      ) {
                        return;
                      }
                      onExpandedTradeIdChange(expanded ? null : trade.id);
                    }}
                    onKeyDown={(event) => {
                      if (isPending || (event.key !== "Enter" && event.key !== " ")) {
                        return;
                      }
                      event.preventDefault();
                      onExpandedTradeIdChange(expanded ? null : trade.id);
                    }}
                    ref={(node) => {
                      if (node) rowRefs.current.set(trade.id, node);
                      else rowRefs.current.delete(trade.id);
                    }}
                    tabIndex={isPending ? -1 : 0}
                  >
                    <td className="px-4 py-3 text-[var(--ledger-muted)]">
                      {trade.occurredAt}
                      {todayKey && isLedgerFactInFuture(trade.occurredAt, todayKey) ? (
                        <span className="ml-2 font-medium text-red-700">未来事实</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          trade.type === "buy"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-900"
                        }`}
                      >
                        {trade.type === "buy" ? "买入" : "卖出"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold">{trade.assetSymbol}</td>
                    <td className="px-3 py-3 text-[var(--ledger-muted)]">
                      {trade.totalValue} {trade.currency}
                    </td>
                    <td className="px-3 py-3 text-[var(--ledger-muted)]">
                      {trade.fee} {trade.feeCurrency}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        {phase === "idle" ? (
                          <button
                            aria-expanded={expanded}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 disabled:opacity-50"
                            disabled={isPending}
                            onClick={() =>
                              onExpandedTradeIdChange(expanded ? null : trade.id)
                            }
                            ref={(node) => {
                              if (node) detailButtonRefs.current.set(trade.id, node);
                              else detailButtonRefs.current.delete(trade.id);
                            }}
                            type="button"
                          >
                            详情
                          </button>
                        ) : null}
                        <TradeDeleteControl
                          ariaLabel={`删除 ${
                            trade.type === "buy" ? "买入" : "卖出"
                          } ${trade.assetSymbol} ${trade.occurredAt}`}
                          className={phase === "idle" ? "" : "col-span-2"}
                          disabled={rowDeleteDisabled}
                          onActivate={() =>
                            phase === "armed"
                              ? onConfirmDelete(trade.id)
                              : onArmDelete(trade.id)
                          }
                          onCancel={onCancelDelete}
                          onUndo={onUndoDelete}
                          phase={phase}
                          remainingMs={
                            isPending ? deleteState.remainingMs : 0
                          }
                        />
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-[#fbfaf7]">
                      <td className="px-4 py-4" colSpan={6}>
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          <Detail label="数量" value={trade.quantity} />
                          <Detail
                            label="成交均价"
                            value={`${trade.price} ${trade.currency}`}
                          />
                          <Detail label="平台" value={trade.platform ?? "未填写"} />
                          <Detail
                            label="手续费来源"
                            value={trade.feeRuleId ? `FeeRule ${trade.feeRuleId}` : "手填"}
                          />
                          <Detail
                            label="现金影响"
                            value={
                              cashImpact.ok
                                ? `${cashImpact.amount} ${cashImpact.currency} · ${
                                    cashImpact.kind === "buy-outflow"
                                      ? "买入总支出"
                                      : "卖出净到账"
                                  }`
                                : `不可可靠计算：${cashImpact.feeCurrency} 手续费未换算`
                            }
                          />
                          <Detail label="备注" value={trade.note ?? "未填写"} />
                        </div>
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

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--ledger-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--ledger-ink)]">{value}</dd>
    </div>
  );
}

function LegacyTradeTable({
  trades,
  onDelete,
  deleteDisabled = false,
  todayKey,
}: Omit<TradeTableProps, "variant">) {
  const columnCount = onDelete ? 10 : 9;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">日期</th>
            <th className="py-2 font-medium">类型</th>
            <th className="py-2 font-medium">资产</th>
            <th className="py-2 font-medium">数量</th>
            <th className="py-2 font-medium">均价</th>
            <th className="py-2 font-medium">成交金额（不含手续费）</th>
            <th className="py-2 font-medium">实际手续费</th>
            <th className="py-2 font-medium">平台 / 手续费来源</th>
            <th className="py-2 font-medium">现金影响</th>
            {onDelete ? <th className="py-2 font-medium">操作</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trades.length === 0 ? (
            <tr>
              <td className="py-8 text-center text-slate-500" colSpan={columnCount}>
                暂无交易。添加交易后，这里会自动显示。
              </td>
            </tr>
          ) : (
            trades.map((trade) => {
              const cashImpact = calculateTradeCashImpact(trade);
              return (
                <tr key={trade.id}>
                  <td className="py-3 text-slate-600">
                    {trade.occurredAt}
                    {todayKey && isLedgerFactInFuture(trade.occurredAt, todayKey) ? (
                      <span className="ml-2 font-medium text-red-700">无效未来事实</span>
                    ) : null}
                  </td>
                  <td className="py-3 text-slate-600">
                    {trade.type === "buy" ? "买入" : "卖出"}
                  </td>
                  <td className="py-3 font-medium">{trade.assetSymbol}</td>
                  <td className="py-3 text-slate-600">{trade.quantity}</td>
                  <td className="py-3 text-slate-600">{trade.price}</td>
                  <td className="py-3 text-slate-600">
                    {trade.totalValue} {trade.currency}
                  </td>
                  <td className="py-3 text-slate-600">
                    {trade.fee} {trade.feeCurrency}
                  </td>
                  <td className="py-3 text-slate-600">
                    {trade.platform ?? "未填写"}
                    <span className="block text-xs text-slate-500">
                      {trade.feeRuleId ? `FeeRule ${trade.feeRuleId}` : "手填"}
                    </span>
                  </td>
                  <td className="py-3 text-slate-600">
                    {cashImpact.ok ? (
                      <>
                        {cashImpact.amount} {cashImpact.currency}
                        <span className="block text-xs text-slate-500">
                          {cashImpact.kind === "buy-outflow"
                            ? "买入总支出"
                            : "卖出净到账"}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-800">
                        不可可靠计算：{cashImpact.feeCurrency} 手续费未换算
                      </span>
                    )}
                  </td>
                  {onDelete ? (
                    <td className="py-3">
                      <ConfirmDeleteButton
                        ariaLabel={`删除 ${
                          trade.type === "buy" ? "买入" : "卖出"
                        } ${trade.assetSymbol} ${trade.occurredAt}`}
                        disabled={deleteDisabled}
                        label="删除"
                        onConfirm={() => onDelete(trade.id)}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
