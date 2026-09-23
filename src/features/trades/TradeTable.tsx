"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { calculateTradeCashImpact } from "@/core/calculations";
import { getLedgerDateKey, isLedgerFactInFuture } from "@/core/shared";
import { LedgerNumber, useLanguage } from "@/ui";
import {
  TradeDeleteControl,
  type TradeDeletePhase,
} from "./TradeDeleteControl";
import { LegacyTradeTable } from "./LegacyTradeTable";
import type { TradeTableProps } from "./tradeTableTypes";

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
  const { t } = useLanguage();
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
            <th className="px-4 py-3 font-medium">{t("trades.table.date")}</th>
            <th className="px-3 py-3 font-medium">{t("trades.table.type")}</th>
            <th className="px-3 py-3 font-medium">{t("trades.table.asset")}</th>
            <th className="px-3 py-3 font-medium">{t("trades.table.totalValue")}</th>
            <th className="px-3 py-3 font-medium">{t("trades.table.fee")}</th>
            <th className="w-56 px-4 py-3 font-medium">{t("trades.table.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ledger-border)] bg-white">
          {trades.length === 0 ? (
            <tr>
              <td className="px-4 py-12 text-center text-[var(--ledger-muted)]" colSpan={6}>
                {t("trades.table.noFilteredTrades")}
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
                        <span className="ml-2 font-medium text-red-700">{t("trades.table.futureFact")}</span>
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
                        {trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold">{trade.assetSymbol}</td>
                    <td className="px-3 py-3 text-[var(--ledger-muted)]">
                      <LedgerNumber kind="money" value={trade.totalValue} />{" "}
                      {trade.currency}
                    </td>
                    <td className="px-3 py-3 text-[var(--ledger-muted)]">
                      <LedgerNumber
                        kind={trade.feeCurrency === "USDT" ? "money" : "quantity"}
                        value={trade.fee}
                      />{" "}
                      {trade.feeCurrency}
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
                            {t("trades.table.details")}
                          </button>
                        ) : null}
                        <TradeDeleteControl
                          ariaLabel={`${t("trades.table.deletePrefix")} ${
                            trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")
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
                          <Detail
                            label={t("trades.table.quantity")}
                            value={<LedgerNumber kind="quantity" value={trade.quantity} />}
                          />
                          <Detail
                            label={t("trades.table.averagePrice")}
                            value={
                              <>
                                <LedgerNumber kind="money" value={trade.price} />{" "}
                                {trade.currency}
                              </>
                            }
                          />
                          <Detail label={t("trades.table.platform")} value={trade.platform ?? t("trades.table.notFilled")} />
                          <Detail
                            label={t("trades.table.feeSource")}
                            value={trade.feeRuleId ? `FeeRule ${trade.feeRuleId}` : t("trades.table.manual")}
                          />
                          <Detail
                            label={t("trades.table.cashImpact")}
                            value={cashImpact.ok ? (
                              <>
                                <LedgerNumber kind="money" value={cashImpact.amount} />{" "}
                                {cashImpact.currency} · {cashImpact.kind === "buy-outflow"
                                  ? t("trades.table.buyOutflow")
                                  : t("trades.table.sellProceeds")}
                              </>
                            ) : `${t("trades.table.unreliablePrefix")}${t("trades.table.unreliableSeparator")}${cashImpact.feeCurrency} ${t("trades.table.unconvertedFee")}`}
                          />
                          <Detail label={t("trades.table.note")} value={trade.note ?? t("trades.table.notFilled")} />
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

function Detail({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--ledger-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--ledger-ink)]">{value}</dd>
    </div>
  );
}
