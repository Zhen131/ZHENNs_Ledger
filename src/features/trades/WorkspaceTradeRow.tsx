"use client";

import {
  getLedgerDateKey,
  isLedgerFactInFuture,
} from "@/core/shared";
import { LedgerNumber } from "@/ui";
import { TradeDeleteControl } from "./TradeDeleteControl";
import type { RefObject } from "react";
import type { TradeDeletePhase } from "./TradeDeleteControl";
import type { useLanguage } from "@/ui";
import type { Trade } from "@/core/models";

export function WorkspaceTradeRow({
  deleteState,
  detailButtonRefs,
  expanded,
  isLocated,
  isPending,
  locationClass,
  locationMode,
  onArmDelete,
  onCancelDelete,
  onConfirmDelete,
  onExpandedTradeIdChange,
  onUndoDelete,
  phase,
  rowDeleteDisabled,
  rowRefs,
  t,
  todayKey,
  trade,
}: Readonly<{
  deleteState: Readonly<{ armedTradeId: string | null; pendingTradeId: string | null; pendingPhase: "countdown" | "persisting" | null; remainingMs: number; }>;
  detailButtonRefs: RefObject<Map<string, HTMLButtonElement>>;
  expanded: boolean;
  isLocated: boolean;
  isPending: boolean;
  locationClass: "" | "ledger-trade-locate-static" | "ledger-trade-locate-flash";
  locationMode: "flashing" | "static" | null;
  onArmDelete: (tradeId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (tradeId: string) => void;
  onExpandedTradeIdChange: (tradeId: string | null) => void;
  onUndoDelete: () => void;
  phase: TradeDeletePhase;
  rowDeleteDisabled: boolean;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  t: ReturnType<typeof useLanguage>["t"];
  todayKey: string | undefined;
  trade: Trade;
}>) {
  return (
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
  );
}
