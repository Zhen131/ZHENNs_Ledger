"use client";

import { LedgerNumber } from "@/ui";
import { cashTypeLabel } from "./cashEventPanelHelpers";
import type { ArmedDelete } from "./cashEventPanelHelpers";
import type {
  CashEvent,
  LedgerData,
} from "@/core/models";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function CashEventPanelEventList({
  armedDelete,
  currentPage,
  currentPageCashEvents,
  isWritable,
  ledgerData,
  orderedCashEvents,
  pendingMutationVersion,
  requestDelete,
  setCurrentPage,
  t,
  totalPages,
}: Readonly<{
  armedDelete: ArmedDelete | null;
  currentPage: number;
  currentPageCashEvents: readonly CashEvent[];
  isWritable: boolean;
  ledgerData: LedgerData;
  orderedCashEvents: CashEvent[];
  pendingMutationVersion: number | null;
  requestDelete: (cashEvent: CashEvent, trigger: HTMLButtonElement) => void;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  t: ReturnType<typeof useLanguage>["t"];
  totalPages: number;
}>) {
  return (
      <div>
        <h4 className="text-sm font-semibold">{t("cash.events.heading")}</h4>
        {ledgerData.cashEvents.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ledger-muted)]">{t("cash.events.empty")}</p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {currentPageCashEvents.map((cashEvent) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                  key={cashEvent.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {cashTypeLabel(cashEvent.type, t)} · {cashEvent.occurredAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-600">
                      {cashEvent.type === "balance-adjustment" ? (
                        <>
                          before <LedgerNumber kind="money" value={cashEvent.balanceBefore} />{" "}
                          → target <LedgerNumber kind="money" value={cashEvent.targetBalance} />{t("cash.adjustment.semicolonSeparator")}
                          adjustment{" "}
                          <LedgerNumber kind="money" value={cashEvent.adjustmentAmount} /> USDT
                        </>
                      ) : (
                        <><LedgerNumber kind="money" value={cashEvent.amount} /> USDT</>
                      )}
                      {cashEvent.note ? ` · ${cashEvent.note}` : ""}
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                    disabled={!isWritable || pendingMutationVersion !== null}
                    onClick={(event) => requestDelete(cashEvent, event.currentTarget)}
                    type="button"
                  >
                    {armedDelete?.cashEventId === cashEvent.id ? t("cash.action.confirmDelete") : t("cash.action.delete")}
                  </button>
                </li>
              ))}
            </ul>
            <div
              aria-label={t("cash.pagination.ariaLabel")}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] pt-3 text-sm"
            >
              <p className="text-[var(--ledger-muted)]">
                {t("cash.pagination.totalPrefix")} {orderedCashEvents.length} {t("cash.pagination.totalSuffix")}{t("cash.pagination.listSeparator")}{t("cash.pagination.pagePrefix")} {currentPage} / {totalPages} {t("cash.pagination.pageSuffix")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((page) => page - 1)}
                  type="button"
                >
                  {t("cash.pagination.previous")}
                </button>
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((page) => page + 1)}
                  type="button"
                >
                  {t("cash.pagination.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
  );
}
