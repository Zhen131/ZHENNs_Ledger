/**
 * 这个文件管现金面板下方的现金记录列表。
 * 列表里的数据和删除怎么处理，都在上层 `CashEventPanel.tsx` 管。
 * 没有特别的决定。
 */
"use client";

import { LedgerNumber, PaginationBar } from "@/ui";
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
import type { Translate } from "@/ui";

/**
 * 这个组件画现金记录列表，最后加的在前，分页显示。
 * 每条显示类型、日期、金额和备注。
 * 校准显示校准前余额、目标余额和差额。
 * 点「删除」第一次变成「确认删除」，再点才真删。
 */
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
  t: Translate;
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
            <PaginationBar
              ariaLabel={t("cash.pagination.ariaLabel")}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] pt-3 text-sm"
              currentPage={currentPage}
              nextLabel={t("cash.pagination.next")}
              onNext={() => setCurrentPage((page) => page + 1)}
              onPrevious={() => setCurrentPage((page) => page - 1)}
              previousLabel={t("cash.pagination.previous")}
              summary={
                <>
                  {t("cash.pagination.totalPrefix")} {orderedCashEvents.length} {t("cash.pagination.totalSuffix")}{t("cash.pagination.listSeparator")}{t("cash.pagination.pagePrefix")} {currentPage} / {totalPages} {t("cash.pagination.pageSuffix")}
                </>
              }
              totalPages={totalPages}
            />
          </>
        )}
      </div>
  );
}
