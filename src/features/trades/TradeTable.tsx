"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { calculateTradeCashImpact } from "@/core/calculations";
import { getLedgerDateKey } from "@/core/shared";
import { useLanguage } from "@/ui";
import {
  type TradeDeletePhase,
} from "./TradeDeleteControl";
import { LegacyTradeTable } from "./LegacyTradeTable";
import type { TradeTableProps } from "./tradeTableTypes";
import { runTradeLocateEffect } from "./workspaceTradeTableEffects";
import { WorkspaceTradeDetailRow } from "./WorkspaceTradeDetailRow";
import { WorkspaceTradeRow } from "./WorkspaceTradeRow";

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
    return runTradeLocateEffect(
      {
        locateRequest,
        onLocateComplete,
        rowRefs,
        setLocatedDate,
        setLocationMode,
        trades,
      },
    );
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
                  <WorkspaceTradeRow
                    deleteState={deleteState}
                    detailButtonRefs={detailButtonRefs}
                    expanded={expanded}
                    isLocated={isLocated}
                    isPending={isPending}
                    locationClass={locationClass}
                    locationMode={locationMode}
                    onArmDelete={onArmDelete}
                    onCancelDelete={onCancelDelete}
                    onConfirmDelete={onConfirmDelete}
                    onExpandedTradeIdChange={onExpandedTradeIdChange}
                    onUndoDelete={onUndoDelete}
                    phase={phase}
                    rowDeleteDisabled={rowDeleteDisabled}
                    rowRefs={rowRefs}
                    t={t}
                    todayKey={todayKey}
                    trade={trade}
                  />
                  {expanded ? (
                    <WorkspaceTradeDetailRow
                      cashImpact={cashImpact}
                      t={t}
                      trade={trade}
                    />
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
